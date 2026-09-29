import { randomBytes } from "node:crypto";

import type { Db } from "../db/client.ts";
import { user } from "../db/schema.ts";
import { hashPassword } from "./password.ts";

export type InitAccountResult =
  | { created: true; username: string }
  | { created: false };

/**
 * SEC1 first-boot: create the single admin account when `user` is empty.
 * D17: password MUST come from ADMIN_PASSWORD — no generated/printed secrets.
 */
export async function ensureInitialUser(db: Db): Promise<InitAccountResult> {
  const existing = await db.select({ id: user.id }).from(user).limit(1);
  if (existing.length > 0) {
    return { created: false };
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      "ADMIN_PASSWORD env var is required to create the initial account (D17)",
    );
  }

  const username = process.env.ADMIN_USERNAME ?? "admin";
  const passwordHash = await hashPassword(adminPassword);
  const now = new Date();

  await db.insert(user).values({
    id: randomBytes(16).toString("hex"),
    username,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  return { created: true, username };
}
