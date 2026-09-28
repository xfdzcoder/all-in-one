import Fastify, { type FastifyInstance } from "fastify";

import { config } from "./config.ts";
import { createDb, ensureSchema, type Db } from "./db/client.ts";
import { LAYOUT_SCHEMA_VERSION } from "./db/schema.ts";

export type AppDeps = {
  db: Db;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({
    ok: true,
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    time: new Date().toISOString(),
  }));

  app.decorate("db", deps.db);
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const { client, db } = createDb();
  await ensureSchema(client);

  const app = buildApp({ db });
  await app.listen({ port: config.port, host: config.host });
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
