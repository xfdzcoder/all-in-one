import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import {
  createCredential,
  deleteCredential,
  listCredentials,
  readSecret,
} from "./store.ts";
import { generateMasterKeyBase64 } from "./crypto.ts";

let dir: string;
let client: Client;
let db: Db;
let userId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-cred-test-"));
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = generateMasterKeyBase64();
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  const rows = await db.query.user.findMany();
  userId = rows[0]!.id;
});

afterAll(() => {
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("credential store (SEC3)", () => {
  it("creates and lists without exposing ciphertext or plaintext", async () => {
    const created = await createCredential(db, userId, "my-api", "http-header", "sk-plain-1");
    expect(created.name).toBe("my-api");
    expect(JSON.stringify(created)).not.toContain("sk-plain-1");
    expect(JSON.stringify(created)).not.toContain("cipherText");

    const list = await listCredentials(db, userId);
    expect(list.map((c) => c.name)).toContain("my-api");
    expect(JSON.stringify(list)).not.toContain("sk-plain-1");
  });

  it("reads back decrypted secret server-side only", async () => {
    const created = await createCredential(db, userId, "mail", "basic-auth", "p@ssw0rd");
    expect(await readSecret(db, userId, created.id)).toBe("p@ssw0rd");
  });

  it("does not leak secrets across users", async () => {
    const created = await createCredential(db, userId, "owned", "generic", "secret-x");
    expect(await readSecret(db, "someone-else", created.id)).toBeNull();
    expect(await deleteCredential(db, "someone-else", created.id)).toBe(false);
  });

  it("deletes credentials", async () => {
    const created = await createCredential(db, userId, "temp", "generic", "s");
    expect(await deleteCredential(db, userId, created.id)).toBe(true);
    expect(await readSecret(db, userId, created.id)).toBeNull();
  });
});
