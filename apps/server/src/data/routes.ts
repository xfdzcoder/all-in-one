import type { FastifyInstance } from "fastify";

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
import { opencodeConnector } from "../connector/opencode.ts";
import { monitorConnector } from "../connector/monitor.ts";
import { serviceOverviewConnector } from "../connector/service.ts";
import { immichGalleryConnector } from "../connector/gallery.ts";
import { navidromeLibraryConnector } from "../connector/navidrome-library.ts";
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

export function createDataChannel(deps: DataChannelDeps): DataChannelDeps {
  return deps;
}

/** 默认数据通道（todo connector 内置；M2-⑤ 注册 http；M3 注册 rss/launcher/iframe-embed）。 */
export function defaultDataChannel(): DataChannelDeps {
  const registry = createConnectorRegistry();
  registry.register(todoConnector);
  registry.register(httpConnector);
  registry.register(rssConnector);
  registry.register(appLauncherConnector);
  registry.register(iframeEmbedConnector);
  registry.register(opencodeConnector);
  registry.register(monitorConnector);
  registry.register(serviceOverviewConnector);
  registry.register(immichGalleryConnector);
  registry.register(navidromeLibraryConnector);
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
    if (!deps.cache.allowFetch(key)) {
      // 限流：返回过期缓存（若有）或 429
      if (cached) return { data: cached.data, fetchedAt: cached.fetchedAt, cached: true };
      return reply.code(429).send({ error: "rate limited" });
    }

    const ctx: FetchContext = {
      db: app.db,
      userId: req.user!.id,
      readSecret: async (credentialId) =>
        readSecretSafe(app.db, req.user!.id, credentialId),
    };
    try {
      // 插件查询不在此预解析 SecretRef —— fetchPluginData 先按 credentialKinds 把关再解密
      const data = isBuiltin
        ? await (async () => {
            const config = await resolveSecretRefs(query.config, ctx);
            return deps.registry.get(query.type).fetch({ ...query, config }, ctx);
          })()
        : await fetchPluginData(app.db, req.user!.id, query, ctx);
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

// readSecret 的惰性 import 包装（避免循环依赖类型问题）
async function readSecretSafe(
  db: FastifyInstance["db"],
  userId: string,
  credentialId: string,
): Promise<string | null> {
  const { readSecret } = await import("../credentials/store.ts");
  return readSecret(db, userId, credentialId);
}
