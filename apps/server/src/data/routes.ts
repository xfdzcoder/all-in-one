import type { FastifyInstance } from "fastify";

import { readSecret } from "../credentials/store.ts";

import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import {
  cacheKeyOf,
  createConnectorRegistry,
  resolveSecretRefs,
  type ConnectorRegistry,
  type FetchContext,
  type WidgetDataQuery,
} from "../connector/registry.ts";
import { DataCache } from "./cache.ts";
import { EventBus, type InvalidationEvent } from "./events.ts";
import { todoConnector } from "../todo/connector.ts";
import { httpConnector } from "../connector/http.ts";
import { rssConnector } from "../feed/connector.ts";
import { appLauncherConnector } from "../connector/launcher.ts";
import { iframeEmbedConnector } from "../connector/iframe.ts";
import { monitorConnector } from "../connector/monitor.ts";
import { serviceOverviewConnector } from "../connector/service.ts";
import { immichGalleryConnector, immichAlbumsConnector, immichPreviewConnector } from "../connector/gallery.ts";
import { navidromeLibraryConnector, navidromeArtistsConnector } from "../connector/navidrome-library.ts";
import { portainerContainersConnector, portainerLogsConnector } from "../connector/portainer-containers.ts";
import { mihomoNodesConnector } from "../connector/mihomo-nodes.ts";
import {
  PluginPermissionError,
  fetchPluginData,
  getEnabledPluginByType,
} from "../plugin/data.ts";

const queryBody = z.object({
  type: z.string().min(1).max(64),
  config: z.record(z.string(), z.unknown()).default({}),
  /** 手动刷新 = 绕过 TTL 但仍受最小间隔限流。 */
  force: z.boolean().optional(),
});

export interface DataChannelDeps {
  registry: ConnectorRegistry;
  cache: DataCache;
  bus: EventBus;
}


/** 默认数据通道（todo connector 内置；M2-⑤ 注册 http；M3 注册 rss/launcher/iframe-embed）。 */
export function defaultDataChannel(): DataChannelDeps {
  const registry = createConnectorRegistry();
  registry.register(todoConnector);
  registry.register(httpConnector);
  registry.register(rssConnector);
  registry.register(appLauncherConnector);
  registry.register(iframeEmbedConnector);
  registry.register(monitorConnector);
  registry.register(serviceOverviewConnector);
  registry.register(immichGalleryConnector);
  registry.register(navidromeLibraryConnector);
  // Q72/D57：配置表单的「只看某相册 / 某艺人」选项源（随 sourceId 变化）
  registry.register(immichAlbumsConnector);
  // Q105（用户反馈④）：灯箱预览大图（点开按需取一张）
  registry.register(immichPreviewConnector);
  registry.register(navidromeArtistsConnector);
  registry.register(portainerContainersConnector);
  registry.register(portainerLogsConnector);
  registry.register(mihomoNodesConnector);
  return {
    registry,
    cache: new DataCache({ defaultTtlSec: 60, minIntervalSec: 5 }),
    bus: new EventBus(),
  };
}

export function registerDataRoutes(app: FastifyInstance, deps: DataChannelDeps): void {
  // POST /api/widgets/data —— 统一取数入口（FR-W3/FR-I3）
  app.post("/api/widgets/data", { preHandler: authGuard }, async (req, reply) => {
    const parsed = queryBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query" });
    const query: WidgetDataQuery = { type: parsed.data.type, config: parsed.data.config };
    const key = cacheKeyOf(query);

    const isBuiltin = deps.registry.has(query.type);
    if (!isBuiltin) {
      // 插件查询（FR-W3 数据桥，D26）：仅已启用插件可取数，权限在 fetchPluginData 内把关
      const pluginRow = await getEnabledPluginByType(app.db, req.user!.id, query.type);
      if (!pluginRow) {
        return reply.code(400).send({ error: `unknown widget type: ${query.type}` });
      }
    }

    const cached = deps.cache.get(key);
    if (cached && !parsed.data.force) {
      return { data: cached.data, fetchedAt: cached.fetchedAt, cached: true };
    }
    // Q87（项 4）：手动刷新要**真的回源** —— force 除了跳过缓存读，也必须跳过
    // `minIntervalSec` 限流，否则连点两次刷新仍会被挡回旧数据（表现为「刷新没用」）。
    if (!parsed.data.force && !deps.cache.allowFetch(key)) {
      // 限流：返回过期缓存（若有）或 429
      if (cached) return { data: cached.data, fetchedAt: cached.fetchedAt, cached: true };
      return reply.code(429).send({ error: "rate limited" });
    }

    const ctx: FetchContext = {
      db: app.db,
      userId: req.user!.id,
      readSecret: async (credentialId) =>
        readSecret(app.db, req.user!.id, credentialId),
    };
    try {
      // 插件查询不在此预解析 SecretRef —— fetchPluginData 先按 credentialKinds 把关再解密
      // SRV-06：同 key 并发取数合并为一次上游调用（single-flight）
      const data = await deps.cache.coalesce(key, async () => {
        if (!isBuiltin) return fetchPluginData(app.db, req.user!.id, query, ctx);
        const config = await resolveSecretRefs(query.config, ctx);
        return deps.registry.get(query.type).fetch({ ...query, config }, ctx);
      });
      const entry = deps.cache.set(key, data);
      return { data: entry.data, fetchedAt: entry.fetchedAt, cached: false };
    } catch (err) {
      if (err instanceof PluginPermissionError) {
        return reply.code(403).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : "fetch failed";
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/events —— SSE 失效通知（FR-I6）
  app.get("/api/events", { preHandler: authGuard }, async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write("retry: 3000\n\n");

    const send = (e: InvalidationEvent) => {
      reply.raw.write(`event: invalidation\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const unsubscribe = deps.bus.subscribe(send);

    // 心跳保活
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return reply;
  });
}

// SRV-28：原「惰性 import 规避循环依赖」的包装已删 —— 实测 credentials/store 只依赖 db 层，
// 与本模块无循环（误认）；且该包装与 portainer/routes.ts 是整段复制。现静态 import 直呼 readSecret。
