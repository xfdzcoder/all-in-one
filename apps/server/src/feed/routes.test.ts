import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;
let upstream: Server;
let port: number;

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Blog</title>
<item><title>Post A</title><link>http://ex.com/a</link><guid>a-1</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><description>Summary A</description></item>
<item><title>Post B</title><link>http://ex.com/b</link><guid>b-2</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate><description>Summary B</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title>
<entry><title>Atom C</title><id>c-3</id><updated>Wed, 03 Jan 2024 10:00:00 GMT</updated><summary>Summary C</summary><link href="http://ex.com/c"/></entry>
</feed>`;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.ALLOW_PRIVATE_OUTBOUND = "1";
  dir = mkdtempSync(join(tmpdir(), "ail-feed-test-"));
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

  upstream = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(req.url === "/atom" ? ATOM : RSS);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  await app.close();
  upstream.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("feed sources API (Workspace-level, D21)", () => {
  it("creates/lists/deletes sources", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "Blog", url: `http://127.0.0.1:${port}/rss` },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/feeds", cookies: { sid } });
    expect(list.json().length).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/feeds/${created.json().id}`,
      cookies: { sid },
    });
    expect(del.statusCode).toBe(200);
    // re-create for connector tests
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "Blog", url: `http://127.0.0.1:${port}/rss` },
    });
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "News", url: `http://127.0.0.1:${port}/atom` },
    });
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/feeds" });
    expect(res.statusCode).toBe(401);
  });
});

describe("rss connector (multi-source + read state)", () => {
  it("aggregates RSS + Atom entries newest first", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 10 }, force: true },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.items.length).toBe(3);
    expect(data.items[0].title).toBe("Atom C"); // newest date first
    expect(data.unread).toBe(3);
    expect(data.sourceCount).toBe(2);
  });

  it("marks read → unread count drops; second mark is idempotent", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 10 }, force: true },
    });
    const itemKey = first.json().data.items[0].itemKey;
    await app.inject({
      method: "POST",
      url: "/api/feeds/read",
      cookies: { sid },
      payload: { itemKey },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 10 }, force: true },
    });
    expect(second.json().data.unread).toBe(2);
    expect(second.json().data.items[0].read).toBe(true);
    // idempotent
    await app.inject({
      method: "POST",
      url: "/api/feeds/read",
      cookies: { sid },
      payload: { itemKey },
    });
    const readList = await app.inject({ method: "GET", url: "/api/feeds/read", cookies: { sid } });
    expect(readList.json().length).toBe(1);
  });

  it("batch mark-read works", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/feeds/read-batch",
      cookies: { sid },
      payload: { itemKeys: ["x1", "x2"] },
    });
    expect(res.statusCode).toBe(200);
    const readList = await app.inject({ method: "GET", url: "/api/feeds/read", cookies: { sid } });
    expect(readList.json().length).toBe(3);
  });

  it("tolerates a failing source (per-source isolation)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "Broken", url: "http://127.0.0.1:1/dead" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 10 }, force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items.length).toBe(3); // 其它源不受影响
    expect(res.json().data.errors.length).toBe(1);
  });
});
