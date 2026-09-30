import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildGmailAuthorizeUrl,
  createGmailClient,
  exchangeGmailCode,
  fetchGmailProfile,
} from "./gmail.ts";
import type { MailConnectionConfig } from "./client.ts";

let mock: Server;
let base: string;
let tokenCalls = 0;
let lastForm = "";
let lastAuth: string | null = null;

const MIME = [
  "From: sender@example.com",
  "To: me@example.com",
  "Subject: =?UTF-8?B?5rWL6K+V6YKu5Lu2?=",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>HTML 正文</p>",
].join("\r\n");

beforeAll(async () => {
  mock = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    lastAuth = req.headers.authorization ?? null;
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/token") {
      tokenCalls++;
      lastForm = await new Promise<string>((resolve) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => resolve(b));
      });
      res.end(JSON.stringify({ access_token: `at-${tokenCalls}`, refresh_token: "rt-1", expires_in: 3600 }));
      return;
    }
    if (url.pathname === "/gmail/v1/users/me/profile") {
      res.end(JSON.stringify({ emailAddress: "me@example.com", messagesTotal: 42 }));
      return;
    }
    if (url.pathname === "/gmail/v1/users/me/messages") {
      res.end(JSON.stringify({ messages: [{ id: "m2" }, { id: "m1" }] }));
      return;
    }
    const m = url.pathname.match(/\/gmail\/v1\/users\/me\/messages\/(\w+)$/);
    if (m) {
      const id = m[1];
      if (url.searchParams.get("format") === "raw") {
        res.end(JSON.stringify({ id, raw: Buffer.from(MIME).toString("base64url"), internalDate: "1700000000000" }));
      } else {
        const newer = id === "m2";
        res.end(
          JSON.stringify({
            id,
            internalDate: newer ? "1700000100000" : "1700000000000",
            labelIds: newer ? ["INBOX"] : ["INBOX", "SEEN"],
            payload: {
              headers: [
                { name: "Subject", value: newer ? "新邮件" : "旧邮件" },
                { name: "From", value: "sender@example.com" },
                { name: "Date", value: "Tue, 14 Nov 2023 00:00:00 +0000" },
              ],
            },
          }),
        );
      }
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  process.env.GMAIL_ACCOUNTS_BASE = base;
  process.env.GMAIL_OAUTH_BASE = base;
  process.env.GMAIL_API_BASE = base;
});

afterAll(() => {
  mock.close();
  delete process.env.GMAIL_ACCOUNTS_BASE;
  delete process.env.GMAIL_OAUTH_BASE;
  delete process.env.GMAIL_API_BASE;
});

const conn = (): MailConnectionConfig => ({
  host: "gmail",
  port: 0,
  security: "oauth2",
  username: "me@example.com",
  password: "rt-1",
  kind: "gmail",
  refreshToken: "rt-1",
  clientId: "cid",
  clientSecret: "csec",
});

describe("Gmail data source (D37: OAuth + messages.list/get 只读)", () => {
  it("builds the authorize URL (scope/state/redirect)", () => {
    const url = buildGmailAuthorizeUrl("cid", "http://localhost:3000/api/mail/gmail/callback", "st-1");
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toContain("gmail.readonly");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("st-1");
    expect(u.searchParams.get("redirect_uri")).toContain("/api/mail/gmail/callback");
  });

  it("exchanges the code for tokens (form-encoded)", async () => {
    const t = await exchangeGmailCode("code-1", "http://localhost:3000/api/mail/gmail/callback", "cid", "csec");
    expect(t.accessToken).toBe("at-1");
    expect(t.refreshToken).toBe("rt-1");
    expect(lastForm).toContain("grant_type=authorization_code");
    expect(lastForm).toContain("code=code-1");
  });

  it("lists messages (newest first, headers + seen flags)", async () => {
    const before = tokenCalls;
    const client = createGmailClient(conn());
    const list = await client.list("INBOX", 10);
    expect(list.map((m) => m.uid)).toEqual(["m2", "m1"]);
    expect(list[0].subject).toBe("新邮件");
    expect(list[0].seen).toBe(false);
    expect(list[1].seen).toBe(true);
    expect(list[0].from).toContain("sender@example.com");
    expect(lastAuth).toMatch(/^Bearer at-/);
    // access_token 缓存：两次取数只交换一次令牌
    await client.list("INBOX", 5);
    expect(tokenCalls).toBe(before + 1);
  });

  it("parses full message bodies (MIME via mailparser)", async () => {
    const client = createGmailClient(conn());
    const full = await client.body("INBOX", "m1");
    expect(full?.subject).toContain("测试邮件");
    expect(full?.html).toContain("<p>HTML 正文</p>");
    expect(full?.seen).toBe(true); // 只读不回写 SEEN（D3）
  });

  it("fetches the account profile for binding display", async () => {
    const p = await fetchGmailProfile("at-x");
    expect(p.emailAddress).toBe("me@example.com");
    expect(p.messagesTotal).toBe(42);
  });
});
