import path from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { config } from "../config.ts";
import {
  PluginInstallError,
  getPlugin,
  installPlugin,
  listPlugins,
  readPluginEntry,
  setPluginStatus,
  uninstallPlugin,
} from "./install.ts";
import { PluginPackageError } from "./package.ts";
import {
  PluginActionError,
  executePluginAction,
  type ActionTopic,
} from "./actions.ts";

/**
 * 插件管理 API（FR-W6）：上传安装 / 列表 / 详情 / 启用 / 禁用 / 卸载 / 入口源码 / 动作。
 * 插件包为 zip（D24），经 base64 传输（≤1.5MB，bodyLimit 放宽）；manifest 属公开元数据。
 * 入口源码以 JSON 下发给宿主沙箱加载器（D25：iframe CSP 隔离），不作 JS 资源伺服。
 * 动作（FR-I5/D27）：permissions.actions 白名单 + 服务端固定 registry 执行 + 审计日志。
 */

const uploadBody = z.object({ packageBase64: z.string().min(1).max(2_000_000) });
const idParams = z.object({ id: z.string().min(1).max(64) });
const actionBody = z.object({
  name: z.string().min(1).max(128),
  params: z.unknown().optional(),
});

export function registerPluginRoutes(
  app: FastifyInstance,
  onChanged: (topic: ActionTopic) => void = () => {},
): void {
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

  /** 入口模块源码 + manifest（宿主沙箱加载器消费，D25）。 */
  app.get("/api/plugins/:id/entry", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const row = await getPlugin(app.db, req.user!.id, params.data.id);
    if (!row) return reply.code(404).send({ error: "not found" });
    try {
      return readPluginEntry(row, { pluginsRoot: pluginsRoot() });
    } catch {
      return reply.code(404).send({ error: "entry not readable" });
    }
  });

  const statusHandler = (status: "enabled" | "disabled") =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "invalid request" });
      try {
        const row = await setPluginStatus(app.db, req.user!.id, params.data.id, status);
        if (!row) return reply.code(404).send({ error: "not found" });
        return row;
      } catch (e) {
        if (e instanceof PluginInstallError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    };

  app.post("/api/plugins/:id/enable", { preHandler: authGuard }, statusHandler("enabled"));
  app.post("/api/plugins/:id/disable", { preHandler: authGuard }, statusHandler("disabled"));

  /** 插件动作（FR-I5/D27）：白名单 + 参数校验 + 服务端执行 + 审计日志。 */
  app.post("/api/plugins/:id/actions", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = actionBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const row = await getPlugin(app.db, req.user!.id, params.data.id);
    if (!row || row.status !== "enabled") {
      return reply.code(400).send({ error: "plugin not installed or disabled" });
    }
    try {
      const { result, topic } = await executePluginAction(
        app.db,
        req.user!.id,
        row,
        body.data.name,
        body.data.params,
      );
      // 审计（FR-I5/NFR1）：结构化日志记 who/which/what；参数不入日志（用户内容/密钥基线）
      app.log.info(
        {
          evt: "plugin.action",
          pluginId: row.id,
          pluginType: row.type,
          action: body.data.name,
          userId: req.user!.id,
        },
        "plugin action executed",
      );
      onChanged(topic);
      return { ok: true, result: result ?? null };
    } catch (e) {
      if (e instanceof PluginActionError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
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
