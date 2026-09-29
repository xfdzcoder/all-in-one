import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { lt } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
import { registerFeedRoutes } from "./feed/routes.ts";
import { registerPluginRoutes } from "./plugin/routes.ts";
import { registerKanbanRoutes } from "./kanban/routes.ts";
import { registerMailRoutes } from "./mail/routes.ts";
import type { MailClientFactory } from "./mail/client.ts";

export type AppDeps = {
  db: Db;
  dataChannel?: DataChannelDeps;
  /** 邮件客户端工厂（默认 imapflow 适配器；测试注入假客户端）。 */
  mailClientFactory?: MailClientFactory;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  // NFR6：结构化日志脱敏 —— 敏感字段永不落日志（SEC3 附带）
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.secret",
          "req.body.apiToken",
          "req.body.token",
        ],
        censor: "[REDACTED]",
      },
    },
  });

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
  registerCredentialRoutes(app);  // Todo 变更 → 失效缓存 + SSE 广播（FR-I6 双页面同步）
  registerTodoRoutes(app, () => {
    dataChannel.cache.clear();
    dataChannel.bus.publish("todo");
  });
  // RSS 变更（源管理/标已读）→ 失效缓存 + SSE（FR：任一组件标已读，其余同步）
  registerFeedRoutes(app, () => {
    dataChannel.cache.clear();
    dataChannel.bus.publish("rss");
  });
  // 插件管理（FR-W6 安装/卸载）；插件动作（D27）→ 失效缓存 + SSE 广播
  registerPluginRoutes(app, (topic) => {
    dataChannel.cache.clear();
    dataChannel.bus.publish(topic);
  });
  // Kanban（Q6a）写操作 → SSE 广播（任一组件改看板，其余同步，FR-I6）
  registerKanbanRoutes(app, () => {
    dataChannel.bus.publish("kanban");
  });
  // 邮件只读聚合（Q7a）：账号管理 + 列表/正文，无写邮箱端点（D3）
  registerMailRoutes(app, { clientFactory: deps.mailClientFactory });

  // NFR1 单镜像部署：PUBLIC_DIR 存在时伺服前端静态资源（SPA fallback 到 index.html）
  const publicDir = process.env.PUBLIC_DIR;
  if (publicDir && existsSync(publicDir)) {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      const filePath = path.join(publicDir, req.url.replace(/^\//, ""));
      if (req.url !== "/" && existsSync(filePath)) {
        const ext = path.extname(filePath);
        const types: Record<string, string> = {
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".html": "text/html",
        };
        reply.type(types[ext] ?? "application/octet-stream").send(readFileSync(filePath));
        return;
      }
      reply.type("text/html").send(readFileSync(path.join(publicDir, "index.html")));
    });
  }
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
