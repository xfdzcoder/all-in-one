import type { FastifyReply, FastifyRequest } from "fastify";

import { findValidSession, revokeSession, SESSION_COOKIE } from "./session.ts";

type CurrentUser = { id: string; username: string };

declare module "fastify" {
  interface FastifyRequest {
    user?: CurrentUser;
  }
}

/** Route guard: 401 + cookie clear when no valid session; sets `req.user` otherwise.
 *  Use as `preHandler: authGuard` on every business route (M1-④ 门禁铺开). */
export async function authGuard(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const found = await findValidSession(req.server.db, token);
  if (!found) {
    if (token) await revokeSession(req.server.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  req.user = { id: found.user.id, username: found.user.username };
}
