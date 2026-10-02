import {createHash, randomBytes} from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import type { Db } from "../db/client.ts";
import { session, user, type Session, type User } from "../db/schema.ts";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionToken = string;

function tokenHash(token: SessionToken): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
): Promise<{ token: SessionToken; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(session).values({
    id: tokenHash(token),
    userId,
    expiresAt,
    createdAt: new Date(),
  });
  return { token, expiresAt };
}

export async function findValidSession(
  db: Db,
  token: SessionToken | undefined,
): Promise<{ session: Session; user: User } | null> {
  if (!token) return null;
  const id = tokenHash(token);
  const rows = await db
    .select({ session, user })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.id, id), gt(session.expiresAt, new Date())));
  return rows[0] ?? null;
}

export async function revokeSession(
  db: Db,
  token: SessionToken | undefined,
): Promise<void> {
  if (!token) return;
  await db.delete(session).where(eq(session.id, tokenHash(token)));
}

/** Constant-time compare helper for future CSRF/token checks. */
