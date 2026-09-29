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

/** 默认数据通道（todo connector 内置；M2-⑤ 注册 http）。 */
export function defaultDataChannel(): DataChannelDeps {
  const registry = createConnectorRegistry();
  registry.register(todoConnector);
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

    if (!deps.registry.has(query.type)) {
      return reply.code(400).send({ error: `unknown widget type: ${query.type}` });
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
      const config = await resolveSecretRefs(query.config, ctx);
      const data = await deps.registry.get(query.type).fetch({ ...query, config }, ctx);
      const entry = deps.cache.set(key, data);
      return { data: entry.data, fetchedAt: entry.fetchedAt, cached: false };
    } catch (err) {
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
