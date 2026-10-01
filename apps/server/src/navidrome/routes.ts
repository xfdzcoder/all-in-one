import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { dataSource } from "../db/schema.ts";
import { outboundRequest, resolveSecretRefs } from "../connector/registry.ts";
import type { FetchContext } from "../connector/registry.ts";
import { authGuard } from "../auth/guard.ts";

/**
 * Navidrome 播放遥控（FR-X3e 写操作，**D51**）：play/pause/next/prev/stop。
 * - 作用于服务器**当前播放会话**（多设备同时收听会互相干扰 —— 组件注明"单设备场景"）；
 * - 免逐次确认（D51：低风险高频）；专属 REST + 审计日志（who/when/what，凭证永不入日志）；
 * - Subsonic 控制端点：pause.view?paused=… / next.view / previous.view / stop.view。
 */

export const NAVIDROME_ACTIONS = ["play", "pause", "next", "prev", "stop"] as const;
export type NavidromeAction = (typeof NAVIDROME_ACTIONS)[number];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Subsonic 认证（salt+md5；口令不入 URL 日志/审计）。 */
async function subsonicAuth(config: Record<string, unknown>): Promise<string> {
  const user = str(config.username) ?? "";
  const pass = str(config.password) ?? "";
  const salt = Math.random().toString(36).slice(2, 10);
  const token = await import("node:crypto").then((c) => c.createHash("md5").update(pass + salt).digest("hex"));
  return `u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=all-in-one&f=json`;
}

/** 动作 → Subsonic 路径（可单测）。 */
export function navidromeControlPath(action: NavidromeAction): string {
  switch (action) {
    case "play":
      return "/rest/pause.view?paused=false";
    case "pause":
      return "/rest/pause.view?paused=true";
    case "next":
      return "/rest/next.view";
    case "prev":
      return "/rest/previous.view";
    case "stop":
      return "/rest/stop.view";
  }
}

export async function navidromeControl(
  ctx: FetchContext,
  sourceId: string,
  action: NavidromeAction,
): Promise<void> {
  const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
  if (row.kind !== "navidrome") throw new Error(`播放遥控需要 Navidrome 连接（当前：${row.kind}）`);
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
  } catch {
    /* noop */
  }
  const config = await resolveSecretRefs(rawConfig, ctx);
  const base = (str(config.url) ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("连接缺少地址");
  const auth = await subsonicAuth(config);
  const path = navidromeControlPath(action);
  const sep = path.includes("?") ? "&" : "?";
  const res = await outboundRequest(`${base}${path}${sep}${auth}`, {
    method: "POST",
    timeoutMs: 8000,
    maxBytes: 50_000,
    allowPrivate: true,
  });
  if (res.status >= 400) throw new Error(`Navidrome 控制接口 HTTP ${res.status}`);
  // Subsonic 错误以 200 + error body 表达
  try {
    const body = JSON.parse(res.text) as Record<string, unknown>;
    const sr = body["subsonic-response"] as Record<string, unknown> | undefined;
    if (sr && (sr as Record<string, unknown>).status === "failed") {
      throw new Error(String((sr.error as Record<string, unknown> | undefined)?.message ?? "控制失败"));
    }
  } catch (e) {
    if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
  }
}

const controlBody = z.object({
  sourceId: z.string().min(1),
  action: z.enum(NAVIDROME_ACTIONS),
});

export function registerNavidromeRoutes(app: FastifyInstance): void {
  /** 播放遥控（FR-X3e/D51）：写操作 + 审计（who/when/what；凭证与 URL 参数不入日志）。 */
  app.post("/api/navidrome/control", { preHandler: authGuard }, async (req, reply) => {
    const body = controlBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    const ctx: FetchContext = {
      db: app.db,
      userId: req.user!.id,
      readSecret: async (credentialId) => readSecretSafe(app.db, req.user!.id, credentialId),
    };
    try {
      await navidromeControl(ctx, body.data.sourceId, body.data.action);
      app.log.info(
        { evt: "widget.write-action", kind: "navidrome-control", action: body.data.action, sourceId: body.data.sourceId, userId: req.user!.id },
        "navidrome media control executed",
      );
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "控制失败" });
    }
  });
}

// readSecret 的惰性 import 包装（同 data/routes.ts，避免循环依赖）
async function readSecretSafe(db: Parameters<typeof import("../credentials/store.ts").readSecret>[0], userId: string, credentialId: string) {
  const { readSecret } = await import("../credentials/store.ts");
  return readSecret(db, userId, credentialId);
}
