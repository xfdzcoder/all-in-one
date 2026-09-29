import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { createCredential } from "./store.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;
let upstream: Server;
let upstreamPort: number;

beforeAll(async () => {
  // E2E 需要访问本机 mock upstream —— 先置 env 再动态 import config 链
  process.env.ALLOW_PRIVATE_OUTBOUND = "1";
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");

  dir = mkdtempSync(join(tmpdir(), "ail-http-test-"));
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  app = buildApp({ db });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-admin-password-123" },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";

  // mock upstream：要求 Bearer token，返回 JSON
  upstream = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer sk-test-token") {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { cpu: 23, mem: 41 }, items: [{ name: "svc-a", value: 1 }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  upstreamPort = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  await app.close();
  upstream.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("credentials API (SEC3)", () => {
  it("creates/lists/deletes without ever returning secret", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/credentials",
      cookies: { sid },
      payload: { name: "api-token", kind: "http-header", secret: "sk-test-token" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain("sk-test-token");
    const id = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/credentials", cookies: { sid } });
    expect(list.body).not.toContain("sk-test-token");
    expect(list.json().map((c: { name: string }) => c.name)).toContain("api-token");

    const del = await app.inject({ method: "DELETE", url: `/api/credentials/${id}`, cookies: { sid } });
    expect(del.statusCode).toBe(200);
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/credentials" });
    expect(res.statusCode).toBe(401);
  });
});

describe("custom-api connector (D14/J5)", () => {
  it("fetches via data channel with secret-ref auth", async () => {
    const cred = await createCredential(db, (await db.select().from((await import("../db/schema.ts")).user))[0]!.id, "j5", "http-header", "sk-test-token");
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: {
        type: "custom-api",
        config: {
          url: `http://127.0.0.1:${upstreamPort}/metrics`,
          method: "GET",
          apiToken: { credentialRef: cred.id },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    // upstream body is { data: {cpu,mem}, items: [...] }; channel wraps as { data: <body> }
    expect(res.json().data.data.cpu).toBe(23);
  });

  it("propagates upstream 401 as 502", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: {
        type: "custom-api",
        config: { url: `http://127.0.0.1:${upstreamPort}/metrics`, method: "GET" },
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/401/);
  });
});
