import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCredential, listCredentials } from "../credentials/store.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { dataSource, user } from "../db/schema.ts";
import { cleanupRetiredDataSources, collectCredentialRefs } from "./legacy-cleanup.ts";

let dir: string;
let client: Client;
let db: Db;
let userId: string;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");
  dir = mkdtempSync(join(tmpdir(), "ail-legacy-test-"));
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  const init = await ensureInitialUser(db);
  expect(init.created).toBe(true);
  const users = await db.select().from(user);
  userId = users[0]!.id;
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("collectCredentialRefs（SEC3 SecretRef 提取）", () => {
  it("认 credentialRef / 旧 credentialId 两种键名，其余忽略", () => {
    const json = JSON.stringify({
      url: "http://x",
      apiToken: { credentialRef: "cred-a" },
      legacy: { credentialId: "cred-b" },
      note: 'credentialRef: "not-a-ref"（非 JSON 键形态，仍会被保守收下——回收侧再判定）',
    });
    expect(collectCredentialRefs(json)).toEqual(["cred-a", "cred-b"]);
    expect(collectCredentialRefs("{}")).toEqual([]);
  });
});

describe("cleanupRetiredDataSources（D66 退役清理）", () => {
  it("删 kind=opencode 行 + 回收孤儿凭证；其它 kind 与仍被引用的凭证保留", async () => {
    const orphan = await createCredential(db, userId, "oc-token", "http-header", "sk-orphan");
    const shared = await createCredential(db, userId, "shared-token", "http-header", "sk-shared");
    const now = new Date();
    await db.insert(dataSource).values([
      { id: "ds-oc-1", userId, kind: "opencode", name: "本机 OC", configJson: JSON.stringify({ url: "http://127.0.0.1:4096", apiToken: { credentialRef: orphan.id } }), createdAt: now, updatedAt: now },
      // 共享凭证：还被另一条存活连接引用 → 必须保留
      { id: "ds-oc-2", userId, kind: "opencode", name: "另一个 OC", configJson: JSON.stringify({ url: "http://127.0.0.1:4097", apiToken: { credentialRef: shared.id } }), createdAt: now, updatedAt: now },
      { id: "ds-mon-1", userId, kind: "monitor", name: "家庭服务器", configJson: JSON.stringify({ url: "http://127.0.0.1:61208", apiToken: { credentialRef: shared.id } }), createdAt: now, updatedAt: now },
    ]);

    const removed = await cleanupRetiredDataSources(db);
    expect(removed).toBe(2);

    const left = await db.select().from(dataSource);
    expect(left.map((r) => r.id)).toEqual(["ds-mon-1"]);
    const creds = (await listCredentials(db, userId)).map((c) => c.id);
    expect(creds).not.toContain(orphan.id);
    expect(creds).toContain(shared.id);

    // 幂等：再跑一次无事发生
    expect(await cleanupRetiredDataSources(db)).toBe(0);
  });
});
