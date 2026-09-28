import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { eq } from "drizzle-orm";

import { user } from "../db/schema.ts";
import { verifyPassword } from "./password.ts";
import {
  SESSION_COOKIE,
  createSession,
  findValidSession,
  revokeSession,
} from "./session.ts";

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
    const username = req.body?.username ?? "";
    const password = req.body?.password ?? "";
    if (!username || !password) {
      return reply.code(400).send({ error: "username and password required" });
    }

    const rows = await app.db
      .select()
      .from(user)
      .where(eq(user.username, username))
      .limit(1);
    const account = rows[0];
    const ok =
      account &&
      (await verifyPassword(account.passwordHash, password));
    if (!ok) {
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
