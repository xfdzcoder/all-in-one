import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { lt } from "drizzle-orm";

import { openApiDoc } from "./api/openapi.ts";
import { ensureInitialUser } from "./auth/ensure-user.ts";
import { registerAuthRoutes } from "./auth/routes.ts";
import { config } from "./config.ts";
import { registerDashboardRoutes } from "./dashboard/routes.ts";
import { seedDefaultDashboard } from "./dashboard/seed.ts";
import {
  defaultDataChannel,
  registerDataRoutes,
  type DataChannelDeps,
} from "./data/routes.ts";
import { createDb, ensureSchema, type Db } from "./db/client.ts";
import { LAYOUT_SCHEMA_VERSION, session } from "./db/schema.ts";
import { registerCredentialRoutes } from "./credentials/routes.ts";
import { registerTodoRoutes } from "./todo/routes.ts";

export type AppDeps = {
  db: Db;
  dataChannel?: DataChannelDeps;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cookie, {});

  app.get("/api/health", async () => ({
    ok: true,
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    time: new Date().toISOString(),
  }));

  // D11: OpenAPI 3.1 generated from the same zod schemas routes validate with.
  app.get("/api/openapi.json", async () => openApiDoc);

  app.decorate("db", deps.db);
  const dataChannel = deps.dataChannel ?? defaultDataChannel();
  registerAuthRoutes(app);
  registerDashboardRoutes(app);
  registerDataRoutes(app, dataChannel);
  registerCredentialRoutes(app);
  // Todo 变更 → 失效缓存 + SSE 广播（FR-I6 双页面同步）
  registerTodoRoutes(app, () => {
    dataChannel.cache.clear();
    dataChannel.bus.publish("todo");
  });
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const { client, db } = await createDb();
  await ensureSchema(db);

  const init = await ensureInitialUser(db);
  if (init.created) {
    // D17: no secrets in logs — password comes from ADMIN_PASSWORD only.
    console.log(`[@all-in-one/server] created account "${init.username}"`);
  }
  await seedDefaultDashboard(db);
  // Housekeeping: drop expired sessions on boot.
  await db.delete(session).where(lt(session.expiresAt, new Date()));

  const app = buildApp({ db });
  await app.listen({ port: config.port, host: config.host });

  // Graceful shutdown (retro P2): close HTTP + DB on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    console.log(`[@all-in-one/server] ${signal} received, shutting down`);
    await app.close();
    client.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
