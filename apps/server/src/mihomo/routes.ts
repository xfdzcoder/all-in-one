import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { dataSource } from "../db/schema.ts";
import { outboundRequest, resolveSecretRefs } from "../connector/registry.ts";
import type { FetchContext } from "../connector/registry.ts";
import { authGuard } from "../auth/guard.ts";

/**
 * Mihomo 策略组切换（FR-X3g 写操作，**D51**）：切换**前确认**（前端显示 当前 → 目标）+ 审计。
 * - 仅改策略组选择（`PUT /proxies/{group}` {name}），不改配置文件、不重载；
 * - 目标节点必须是该组 `all` 成员（服务端校验，防越界注入）。
 */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 成员校验 + 切换（返回 当前→目标 供审计/回显，可单测）。 */
export async function mihomoSelect(
  ctx: FetchContext,
  sourceId: string,
  group: string,
  name: string,
): Promise<{ from: string; to: string }> {
  const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
  if (row.kind !== "mihomo") throw new Error(`策略组切换需要 Mihomo 连接（当前：${row.kind}）`);
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
  } catch {
    /* noop */
  }
  const config = await resolveSecretRefs(rawConfig, ctx);
  const base = (str(config.url) ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("连接缺少地址");
  const headers = {
    Authorization: `Bearer ${str(config.secret) ?? ""}`,
    "Content-Type": "application/json",
  };

  const listRes = await outboundRequest(`${base}/proxies`, {
    headers,
    timeoutMs: 8000,
    maxBytes: 2_000_000,
    allowPrivate: true,
  });
  if (listRes.status >= 400) throw new Error(`mihomo API HTTP ${listRes.status}`);
  const proxies = ((JSON.parse(listRes.text) ?? {}) as Record<string, unknown>).proxies as
    | Record<string, Record<string, unknown>>
    | undefined;
  const g = proxies?.[group];
  if (!g || !Array.isArray(g.all)) throw new Error(`「${group}」不是可切换的策略组`);
  const members = (g.all as unknown[]).map(String);
  if (!members.includes(name)) throw new Error(`「${name}」不是「${group}」的成员`);
  const from = str(g.now) ?? "";

  const res = await outboundRequest(`${base}/proxies/${encodeURIComponent(group)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name }),
    timeoutMs: 8000,
    maxBytes: 50_000,
    allowPrivate: true,
  });
  if (res.status >= 400) throw new Error(`切换失败 HTTP ${res.status}`);
  return { from, to: name };
}

const selectBody = z.object({
  sourceId: z.string().min(1),
  group: z.string().min(1),
  name: z.string().min(1),
});

export function registerMihomoRoutes(app: FastifyInstance): void {
  /** 策略组切换（FR-X3g/D51）：成员校验 + 审计（组/节点入日志，凭证不入）。 */
  app.post("/api/mihomo/select", { preHandler: authGuard }, async (req, reply) => {
    const body = selectBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    const ctx: FetchContext = {
      db: app.db,
      userId: req.user!.id,
      readSecret: async (credentialId) => readSecretSafe(app.db, req.user!.id, credentialId),
    };
    try {
      const { from, to } = await mihomoSelect(ctx, body.data.sourceId, body.data.group, body.data.name);
      app.log.info(
        { evt: "widget.write-action", kind: "mihomo-select", group: body.data.group, from, to, sourceId: body.data.sourceId, userId: req.user!.id },
        "mihomo group selection changed",
      );
      return { ok: true, from, to };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "切换失败" });
    }
  });
}

// readSecret 的惰性 import 包装（同 data/routes.ts，避免循环依赖）
async function readSecretSafe(db: Parameters<typeof import("../credentials/store.ts").readSecret>[0], userId: string, credentialId: string) {
  const { readSecret } = await import("../credentials/store.ts");
  return readSecret(db, userId, credentialId);
}
