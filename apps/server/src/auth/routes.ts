import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { eq } from "drizzle-orm";

import { user } from "../db/schema.ts";
import { loginBody } from "../api/schemas.ts";
import { verifyPassword } from "./password.ts";
import {
  SESSION_COOKIE,
  createSession,
  findValidSession,
  revokeSession,
} from "./session.ts";

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

async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; username: string } | null> {
  const token = req.cookies[SESSION_COOKIE];
  const found = await findValidSession(req.server.db, token);
  if (!found) {
    clearSessionCookie(reply);
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return { id: found.user.id, username: found.user.username };
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

  app.get("/api/auth/me", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    return me;
  });
}

export { requireUser };
