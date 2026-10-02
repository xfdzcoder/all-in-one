import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { eq } from "drizzle-orm";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { feedRead } from "../db/schema.ts";
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

// D68：带属性元素（Atom `<title type="html">` CDATA / RSS `<guid isPermaLink>`）——
// 用户反馈的 theverge 形态；旧归一把它们转成 "[object Object]"（标题/摘要/已读去重全错）
const ATTRIBUTED = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Attr</title>
<item><title type="html"><![CDATA[Post&#x2019;s <b>one</b>]]></title><link>http://ex.com/g1</link><guid isPermaLink="true">http://ex.com/g1</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><description type="html"><![CDATA[<p>Desc &amp; one &#x2019;</p>]]></description></item>
<item><title>Plain two</title><link>http://ex.com/g2</link><guid isPermaLink="false">g2</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate><description>Desc two</description></item>
</channel></rss>`;

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
    if (req.url === "/atom") res.end(ATOM);
    else if (req.url === "/attributed") res.end(ATTRIBUTED);
    else res.end(RSS);
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
    // CON-8：GET /api/feeds/read、POST /api/feeds/read-batch 均为孤儿端点已删 —— oracle 改 DB 直查
    const rows = await db.select().from(feedRead).where(eq(feedRead.itemKey, itemKey));
    expect(rows.length).toBe(1);
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

describe("rss 条目数语义（Q22a：展示条数 = 过滤后切片；数值容错）", () => {
  it("字符串型 limit 照常生效（不再静默回退 20）", async () => {
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "Blog2", url: `http://127.0.0.1:${port}/rss2` },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: "2" }, force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items.length).toBe(2);
  });

  it("filter=unread 时先过滤再切片（条目数=展示条数）", async () => {
    const all = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 3 }, force: true },
    });
    const items = all.json().data.items as Array<{ itemKey: string; read: boolean }>;
    // 标记一条未读为已读（前置用例可能已读过最新条 —— 取未读项保证落差）
    const target = items.find((i) => !i.read);
    expect(target).toBeDefined();
    await app.inject({
      method: "POST",
      url: "/api/feeds/read",
      cookies: { sid },
      payload: { itemKey: target!.itemKey },
    });
    const unreadOnly = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 2, filter: "unread" }, force: true },
    });
    const got = unreadOnly.json().data;
    expect(got.items.length).toBe(2);
    expect(got.items.every((i: { read: boolean }) => !i.read)).toBe(true);
    // 未读徽标 = 全部未读（非仅展示条）：标记 1 条后比取数里的未读总数少 1
    const unreadBefore = all.json().data.unread as number;
    expect(got.unread).toBe(unreadBefore - 1);
    expect(got.unread).toBeGreaterThan(got.items.length - 1);
  });

  it("Q29c: successful fetch snapshots items; failure falls back to snapshot", async () => {
    let fail = false;
    const flaky = createServer((_req, res) => {
      if (fail) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<?xml version="1.0"?><rss version="2.0"><channel><title>F</title><item><title>flaky-1</title><link>http://f/1</link><guid>f-1</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item></channel></rss>',
      );
    });
    await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", r));
    const fport = (flaky.address() as { port: number }).port;
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "flaky", url: `http://127.0.0.1:${fport}/f.xml` },
    });
    const ok1 = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 50 }, force: true },
    });
    const items1 = ok1.json().data.items as Array<{ sourceTitle: string }>;
    expect(items1.some((i) => i.sourceTitle === "flaky")).toBe(true);

    fail = true;
    // TST-7：原「等过 5s 限流窗口」是 Q87 前的旧契约残留 —— 现 force 同时穿透 TTL 与
    // minIntervalSec（限流本身由 data/routes.test 直测覆盖），无需真等。
    const ok2 = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "rss", config: { limit: 50 }, force: true },
    });
    const data2 = ok2.json().data as {
      items: Array<{ sourceTitle: string; title: string; stale?: boolean }>;
      staleSources: string[];
      errors: Array<{ title: string }>;
    };
    const flakyItems = data2.items.filter((i) => i.sourceTitle === "flaky");
    expect(flakyItems.length).toBe(1);
    expect(flakyItems[0].title).toBe("flaky-1");
    expect(flakyItems[0].stale).toBe(true);
    expect(data2.staleSources).toContain("flaky");
    expect(data2.errors.some((e) => e.title === "flaky")).toBe(false);
    flaky.close();
  }, 15000);
});

describe("D68：带属性节点归一（[object Object] 修复 + 已读去重）", () => {
  it("带属性元素取 #text、摘要剥 HTML + 解实体、itemKey 互不相同", async () => {
    await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "attributed", url: `http://127.0.0.1:${port}/attributed` },
    });
    type Item = { link: string; title: string; summary: string; itemKey: string; read: boolean };
    const pick = async (): Promise<{ g1: Item; g2: Item; count: number }> => {
      const res = await app.inject({
        method: "POST",
        url: "/api/widgets/data",
        cookies: { sid },
        payload: { type: "rss", config: { limit: 50 }, force: true },
      });
      const items = (res.json().data.items as Item[]).filter((i) => i.link.startsWith("http://ex.com/g"));
      const empty: Item = { link: "", title: "(missing)", summary: "(missing)", itemKey: "(missing)", read: false };
      return {
        g1: items.find((i) => i.link === "http://ex.com/g1") ?? empty,
        g2: items.find((i) => i.link === "http://ex.com/g2") ?? empty,
        count: items.length,
      };
    };

    const before = await pick();
    expect(before.count).toBe(2);
    // 标题/摘要不再是 [object Object]：CDATA 里的 HTML → 纯文本 + 实体解码
    expect(before.g1.title).toBe("Post’s one");
    expect(before.g1.summary).toBe("Desc & one ’");
    expect(before.g2.title).toBe("Plain two");
    // 旧 bug：`<guid isPermaLink>` 与带属性 title 归一成同一个 "[object Object]" → 全源同一 itemKey
    expect(before.g1.itemKey).not.toBe(before.g2.itemKey);

    // 已读去重：标 g1 只清 g1（旧 bug 会把 g2 一起清 —— 同 key）
    await app.inject({
      method: "POST",
      url: "/api/feeds/read",
      cookies: { sid },
      payload: { itemKey: before.g1.itemKey },
    });
    const after = await pick();
    expect(after.g1.read).toBe(true);
    expect(after.g2.read).toBe(false);
  });
});
