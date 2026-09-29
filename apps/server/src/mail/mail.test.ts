import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { createCredential } from "../credentials/store.ts";
import { user } from "../db/schema.ts";
import type {
  MailClient,
  MailClientFactory,
  MailConnectionConfig,
  MailMessageSummary,
} from "./client.ts";
import { HTML_CAP, clearMailCache } from "./service.ts";

const HOST_A = "203.0.113.10"; // TEST-NET-3：合法公网 IP（免 DNS）
const HOST_B = "203.0.113.20";
const HOST_DOWN = "203.0.113.30";
const HOST_PRIV = "127.0.0.1"; // 内网 → SSRF 基线拒绝（未开逃生阀）
const PASSWORD = "sk-mail-pass";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;
let credId: string;
const calls: MailConnectionConfig[] = [];

const messages: Record<string, MailMessageSummary[]> = {
  [HOST_A]: [
    { uid: 2, subject: "A2", from: "a2@example.com", date: "2026-09-29T10:00:00.000Z", seen: false },
    { uid: 1, subject: "A1", from: "a1@example.com", date: "2026-09-28T10:00:00.000Z", seen: true },
  ],
  [HOST_B]: [
    { uid: 7, subject: "B1", from: "b1@example.com", date: "2026-09-30T10:00:00.000Z", seen: false },
  ],
};

const factory: MailClientFactory = (conn: MailConnectionConfig): MailClient => ({
  async list(_folder, limit) {
    calls.push(conn);
    if (conn.host === HOST_DOWN) throw new Error("connection refused");
    return (messages[conn.host] ?? []).slice(0, limit);
  },
  async body(_folder, uid) {
    calls.push(conn);
    if (conn.host === HOST_DOWN) throw new Error("connection refused");
    const base = (messages[conn.host] ?? []).find((m) => m.uid === uid);
    if (!base) return null;
    return {
      ...base,
      text: "纯文本正文",
      html: uid === 2 ? `<p>${"x".repeat(HTML_CAP + 1000)}</p>` : "<p>hello</p>",
    };
  },
});

type InjectMethod = "GET" | "POST" | "PATCH" | "DELETE";
const req = (
  method: InjectMethod,
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> => {
  const opts: InjectOptions = { method, url, cookies: { sid } };
  if (payload !== undefined) opts.payload = payload as InjectOptions["payload"];
  return app.inject(opts);
};

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");
  // 注意：不开 ALLOW_PRIVATE_OUTBOUND —— 内网 IMAP 目标应被 SSRF 基线拒绝

  dir = mkdtempSync(join(tmpdir(), "ail-mail-test-"));
  const dbUrl = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = dbUrl;
  ({ client, db } = await createDb(dbUrl));
  await ensureSchema(db);
  await ensureInitialUser(db);
  const users = await db.select().from(user).limit(1);
  credId = (await createCredential(db, users[0].id, "mail-pass", "generic", PASSWORD)).id;

  app = buildApp({ db, mailClientFactory: factory });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-admin-password-123" },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";
});

afterAll(async () => {
  await app.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("mail read-only aggregation (Q7a, D3/SEC3/SEC4)", () => {
  let idA = "";
  let idB = "";

  it("manages accounts and never returns secrets", async () => {
    const a = await req("POST", "/api/mail/accounts", {
      name: "邮箱 A",
      host: HOST_A,
      username: "a@example.com",
      credentialId: credId,
    });
    expect(a.statusCode).toBe(201);
    expect(a.body).not.toContain(PASSWORD);
    idA = a.json().id;

    const b = await req("POST", "/api/mail/accounts", {
      name: "邮箱 B",
      host: HOST_B,
      username: "b@example.com",
      security: "starttls",
    });
    idB = b.json().id;

    const list = await req("GET", "/api/mail/accounts");
    expect(list.json()).toHaveLength(2);
    expect(list.body).not.toContain(PASSWORD);
  });

  it("aggregates lists across accounts (newest first) with per-account error isolation", async () => {
    await req("POST", "/api/mail/accounts", {
      name: "挂掉的邮箱",
      host: HOST_DOWN,
      username: "d@example.com",
    });
    await req("POST", "/api/mail/accounts", {
      name: "内网邮箱",
      host: HOST_PRIV,
      username: "p@example.com",
      credentialId: credId,
    });

    clearMailCache();
    const res = await req("GET", "/api/mail/messages?limit=10");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((i: { subject: string }) => i.subject)).toEqual(["B1", "A2", "A1"]);
    expect(body.items.every((i: { accountName: string }) => typeof i.accountName === "string")).toBe(true);
    expect(body.errors).toHaveLength(2);
    expect(body.errors.some((e: { error: string }) => e.error.includes("SSRF"))).toBe(true);
    expect(body.errors.some((e: { error: string }) => e.error.includes("connection refused"))).toBe(true);
  });

  it("serves list from cache within TTL (client hit once per account)", async () => {
    clearMailCache();
    calls.length = 0;
    await req("GET", "/api/mail/messages?limit=10");
    await req("GET", "/api/mail/messages?limit=10");
    const hosts = calls.map((c) => c.host);
    // 第一次拉取、第二次命中缓存：每账号只连一次
    expect(hosts.filter((h) => h === HOST_A)).toHaveLength(1);
    expect(hosts.filter((h) => h === HOST_B)).toHaveLength(1);
    // 凭证明文只在连接期传给客户端（SEC3：不入响应/日志）
    expect(calls.find((c) => c.host === HOST_A)?.password).toBe(PASSWORD);
  });

  it("returns message body with truncation and resolves password per account", async () => {
    const res = await req("GET", `/api/mail/messages/${idA}/1`);
    expect(res.statusCode).toBe(200);
    const full = res.json();
    expect(full.subject).toBe("A1");
    expect(full.text).toContain("纯文本正文");
    expect(full.html).toContain("hello");
    expect(res.body).not.toContain(PASSWORD);

    const big = await req("GET", `/api/mail/messages/${idA}/2`);
    expect(big.statusCode).toBe(200);
    expect(big.json().html).toContain("…（已截断）");
    expect(big.json().html.length).toBeLessThanOrEqual(HTML_CAP + 10);
  });

  it("404s unknown message/account and validates input", async () => {
    expect((await req("GET", `/api/mail/messages/${idA}/999`)).statusCode).toBe(404);
    expect((await req("GET", "/api/mail/messages/nope/1")).statusCode).toBe(404);
    expect(
      (await req("POST", "/api/mail/accounts", { name: "", host: HOST_A, username: "x" })).statusCode,
    ).toBe(400);
    expect((await req("PATCH", `/api/mail/accounts/${idB}`, {})).statusCode).toBe(400);
  });

  it("updates and deletes accounts", async () => {
    const patched = await req("PATCH", `/api/mail/accounts/${idB}`, { folder: "Archive" });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().folder).toBe("Archive");
    expect((await req("DELETE", `/api/mail/accounts/${idB}`)).statusCode).toBe(200);
    expect((await req("DELETE", `/api/mail/accounts/${idB}`)).statusCode).toBe(404);
    const left = await req("GET", "/api/mail/accounts");
    expect(left.json()).toHaveLength(3);
  });
});
