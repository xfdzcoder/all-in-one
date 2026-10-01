import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { dataSource } from "../db/schema.ts";
import { outboundRequest, resolveSecretRefs } from "../connector/registry.ts";
import type { FetchContext } from "../connector/registry.ts";
import { authGuard } from "../auth/guard.ts";

/**
 * Portainer 容器重启（FR-X3f 写操作，**D51**）：**仅 restart**（无 start/stop/delete）。
 * - **容器白名单**（存在连接配置 `restartAllow`，逗号分隔或数组；**缺省空 = 禁止一切重启**）；
 *   白名单落在连接配置（而非组件配置）——服务端可信执行，组件只负责展示与确认；
 * - **D31 二次确认**（前端 ConfirmAction 显示容器名）+ 审计日志（who/when/which）；
 * - 白名单判定按容器**名称**（restart 语义对用户是"重启某服务"，名称比随机 id 稳定）。
 */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 白名单解析（字符串逗号分隔 / 数组；空 = 拒绝一切）。 */
export function parseRestartAllow(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

/** 容器名归一（Docker Names[0] 带前导 /）。 */
function cleanName(name: string): string {
  return name.replace(/^\//, "");
}

export async function portainerRestart(ctx: FetchContext, sourceId: string, containerId: string): Promise<string> {
  const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
  if (row.kind !== "portainer") throw new Error(`容器重启需要 Portainer 连接（当前：${row.kind}）`);
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
  } catch {
    /* noop */
  }
  const config = await resolveSecretRefs(rawConfig, ctx);
  const base = (str(config.url) ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("连接缺少地址");
  const headers = { "X-API-Key": str(config.apiToken) ?? "" };

  const allow = parseRestartAllow(rawConfig.restartAllow);
  if (allow.length === 0) throw new Error("重启未开放：该连接未配置重启白名单（restartAllow，留空 = 禁止重启）");

  // 环境 → 容器清单 → 名称校验（白名单按名称）
  const epsRes = await outboundRequest(`${base}/api/endpoints`, {
    headers,
    timeoutMs: 8000,
    maxBytes: 500_000,
    allowPrivate: true,
  });
  if (epsRes.status >= 400) throw new Error(`portainer API HTTP ${epsRes.status}`);
  const eps = JSON.parse(epsRes.text) as Array<Record<string, unknown>>;
  const epId = eps[0]?.Id;
  if (typeof epId !== "number") throw new Error("无可用环境");

  const listRes = await outboundRequest(`${base}/api/endpoints/${epId}/docker/containers/json?all=1`, {
    headers,
    timeoutMs: 8000,
    maxBytes: 2_000_000,
    allowPrivate: true,
  });
  if (listRes.status >= 400) throw new Error(`portainer API HTTP ${listRes.status}`);
  const list = JSON.parse(listRes.text) as Array<Record<string, unknown>>;
  const target = list.find((c) => str(c.Id) === containerId);
  if (!target) throw new Error("容器不存在");
  const name = cleanName(str((target.Names as string[] | undefined)?.[0]) ?? "");
  if (!allow.includes(name)) throw new Error(`「${name}」不在重启白名单内（连接配置 restartAllow）`);

  const res = await outboundRequest(
    `${base}/api/endpoints/${epId}/docker/containers/${encodeURIComponent(containerId)}/restart`,
    { method: "POST", headers, timeoutMs: 15_000, maxBytes: 50_000, allowPrivate: true },
  );
  if (res.status >= 400) throw new Error(`容器重启失败 HTTP ${res.status}`);
  return name;
}

const restartBody = z.object({
  sourceId: z.string().min(1),
  containerId: z.string().min(1),
});

export function registerPortainerRoutes(app: FastifyInstance): void {
  /** 容器重启（FR-X3f/D51）：仅 restart + 白名单 + 审计（容器名入日志，凭证不入）。 */
  app.post("/api/portainer/restart", { preHandler: authGuard }, async (req, reply) => {
    const body = restartBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    const ctx: FetchContext = {
      db: app.db,
      userId: req.user!.id,
      readSecret: async (credentialId) => readSecretSafe(app.db, req.user!.id, credentialId),
    };
    try {
      const name = await portainerRestart(ctx, body.data.sourceId, body.data.containerId);
      app.log.info(
        { evt: "widget.write-action", kind: "portainer-restart", container: name, sourceId: body.data.sourceId, userId: req.user!.id },
        "portainer container restarted",
      );
      return { ok: true, name };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "重启失败" });
    }
  });
}

// readSecret 的惰性 import 包装（同 data/routes.ts，避免循环依赖）
async function readSecretSafe(db: Parameters<typeof import("../credentials/store.ts").readSecret>[0], userId: string, credentialId: string) {
  const { readSecret } = await import("../credentials/store.ts");
  return readSecret(db, userId, credentialId);
}
