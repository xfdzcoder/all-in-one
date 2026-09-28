import { randomBytes } from "node:crypto";

import type { Db } from "../db/client.ts";
import { user } from "../db/schema.ts";
import { hashPassword } from "./password.ts";

export type InitAccountResult =
  | { created: true; username: string; password: string }
  | { created: false; username: string };

/**
 * SEC1 first-boot: create the single admin account when `user` is empty.
 * Password comes from ADMIN_PASSWORD, else a one-time random secret is printed.
 */
export async function ensureInitialUser(db: Db): Promise<InitAccountResult> {
  const existing = await db.select({ id: user.id }).from(user).limit(1);
  if (existing.length > 0) {
    const row = await db
      .select({ username: user.username })
      .from(user)
      .limit(1);
    return { created: false, username: row[0]?.username ?? "unknown" };
  }

  const username = process.env.ADMIN_USERNAME ?? "admin";
  const generated = randomBytes(12).toString("base64url");
  const password = process.env.ADMIN_PASSWORD ?? generated;
  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db.insert(user).values({
    id: randomBytes(16).toString("hex"),
    username,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  return { created: true, username, password };
}
