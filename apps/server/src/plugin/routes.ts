import path from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { config } from "../config.ts";
import {
  PluginInstallError,
  getPlugin,
  installPlugin,
  listPlugins,
  uninstallPlugin,
} from "./install.ts";
import { PluginPackageError } from "./package.ts";

/**
 * 插件管理 API（FR-W6）：上传安装 / 列表 / 详情 / 卸载（启用/禁用随运行时加载实现）。
 * 插件包为 zip（D24），经 base64 传输（≤1.5MB，bodyLimit 放宽）；manifest 属公开元数据。
 */

const uploadBody = z.object({ packageBase64: z.string().min(1).max(2_000_000) });
const idParams = z.object({ id: z.string().min(1).max(64) });

export function registerPluginRoutes(app: FastifyInstance): void {
  const pluginsRoot = () => path.join(config.dataDir, "plugins");

  app.post("/api/plugins", { preHandler: authGuard, bodyLimit: 3_000_000 }, async (req, reply) => {
    const parsed = uploadBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const pkg = Buffer.from(parsed.data.packageBase64, "base64");
    if (pkg.byteLength === 0) return reply.code(400).send({ error: "invalid package" });
    try {
      const row = await installPlugin(app.db, req.user!.id, pkg, { pluginsRoot: pluginsRoot() });
      return reply.code(201).send(row);
    } catch (e) {
      if (e instanceof PluginInstallError) return reply.code(e.status).send({ error: e.message });
      if (e instanceof PluginPackageError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.get("/api/plugins", { preHandler: authGuard }, async (req) => {
    return listPlugins(app.db, req.user!.id);
  });

  app.get("/api/plugins/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const row = await getPlugin(app.db, req.user!.id, params.data.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.delete("/api/plugins/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const ok = await uninstallPlugin(app.db, req.user!.id, params.data.id, {
      pluginsRoot: pluginsRoot(),
    });
    if (!ok) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
