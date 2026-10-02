import type { FastifyInstance, FastifyReply } from "fastify";

import { eq } from "drizzle-orm";

import { user } from "../db/schema.ts";
import { changePasswordBody, changeUsernameBody, loginBody } from "../api/schemas.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import {
  SESSION_COOKIE,
  createSession,
  revokeOtherSessions,
  revokeSession,
} from "./session.ts";
import { authGuard } from "./guard.ts";

/** argon2id hash of a random secret — verify() against it when user is missing,
 *  so login latency does not reveal whether an account exists. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$GfJvhy9EvNvZNOoiuHDeJw$eiVfcKna69BaodK59wdxgzKGKrKe+dvUl8LgvwBO2t4";

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  // SEC1: httpOnly cookie; Secure off for LAN/HTTP MVP (enable behind HTTPS later).
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{
    Body: { username?: string; password?: string };
  }>("/api/auth/login", async (req, reply) => {
    // CON-2：接线 zod（此前手写 truthy 检查 —— OpenAPI 声明的 username≤128 / password≤256
    // 形同虚设，超长口令照样进 argon2；契约与实现漂移）
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "username and password required" });
    }
    const { username, password } = parsed.data;

    const rows = await app.db
      .select()
      .from(user)
      .where(eq(user.username, username))
      .limit(1);
    const account = rows[0];
    // Anti timing-enumeration: always run an argon2 verify, even when no user
    // exists (use a dummy hash of the same shape).
    const ok = await verifyPassword(
      account?.passwordHash ?? DUMMY_HASH,
      password,
    );
    if (!ok || !account) {
      return reply.code(401).send({ error: "invalid credentials" });
    }

    const { token, expiresAt } = await createSession(app.db, account.id);
    setSessionCookie(reply, token, expiresAt);
    return { id: account.id, username: account.username };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await revokeSession(app.db, req.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // SRV-14：与全库路由同款 authGuard（原 requireUser 是同一逻辑的手抄第二份；
  // authGuard 顺带清掉过期 token 会话，语义更完整）
  app.get("/api/auth/me", { preHandler: authGuard }, async (req) => {
    return req.user!;
  });

  // FR-S2（Q110）：改用户名 —— **必须验证当前密码**；同名占用 409
  app.post("/api/auth/change-username", { preHandler: authGuard }, async (req, reply) => {
    const parsed = changeUsernameBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request" });
    const { currentPassword, username } = parsed.data;
    const me = req.user!;
    const rows = await app.db.select().from(user).where(eq(user.id, me.id)).limit(1);
    const account = rows[0];
    if (!account) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      return reply.code(401).send({ error: "当前密码不正确" });
    }
    const dup = await app.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username))
      .limit(1);
    if (dup.length > 0 && dup[0].id !== me.id) {
      return reply.code(409).send({ error: "用户名已被占用" });
    }
    await app.db.update(user).set({ username, updatedAt: new Date() }).where(eq(user.id, me.id));
    return { id: me.id, username };
  });

  // FR-S2（Q110）：改密码 —— **必须验证当前密码**；改后吊销其它会话（保留当前）
  app.post("/api/auth/change-password", { preHandler: authGuard }, async (req, reply) => {
    const parsed = changePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "当前口令与新口令都要填写" });
    }
    const { currentPassword, newPassword } = parsed.data;
    const me = req.user!;
    const rows = await app.db.select().from(user).where(eq(user.id, me.id)).limit(1);
    const account = rows[0];
    if (!account) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      return reply.code(401).send({ error: "当前密码不正确" });
    }
    const passwordHash = await hashPassword(newPassword);
    await app.db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, me.id));
    await revokeOtherSessions(app.db, me.id, req.cookies[SESSION_COOKIE]);
    return { ok: true };
  });
}

