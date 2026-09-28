import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { ensureInitialUser } from "./auth/ensure-user.ts";
import { registerAuthRoutes } from "./auth/routes.ts";
import { config } from "./config.ts";
import { createDb, ensureSchema, type Db } from "./db/client.ts";
import { LAYOUT_SCHEMA_VERSION } from "./db/schema.ts";

export type AppDeps = {
  db: Db;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cookie, {});

  app.get("/api/health", async () => ({
    ok: true,
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    time: new Date().toISOString(),
  }));

  app.decorate("db", deps.db);
  registerAuthRoutes(app);
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const { client, db } = createDb();
  await ensureSchema(client);

  const init = await ensureInitialUser(db);
  if (init.created) {
    // One-time credentials for J1 first-run bootstrap (never logged again).
    console.log(
      `[@all-in-one/server] created account "${init.username}"` +
        (process.env.ADMIN_PASSWORD
          ? " (password from ADMIN_PASSWORD)"
          : ` one-time password: ${init.password}`),
    );
  }

  const app = buildApp({ db });
  await app.listen({ port: config.port, host: config.host });
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
