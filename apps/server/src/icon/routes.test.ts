import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { customIcon, user } from "../db/schema.ts";
import { looksUnsafeSvg, sanitizeSvg } from "./sanitize.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  dir = mkdtempSync(join(tmpdir(), "ail-icon-test-"));
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
});

afterAll(async () => {
  await app.close();
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("自定义图标库（Q38b/D45）", () => {
  it("上传/清单/取文件（CSP·nosniff）/删除 全链", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex"); // PNG 头
    const up = await app.inject({
      method: "POST",
      url: "/api/icons",
      cookies: { sid },
      payload: { name: "我的图标", mime: "image/png", dataBase64: png.toString("base64") },
    });
    expect(up.statusCode).toBe(201);
    const row = up.json() as { id: string; name: string };
    expect(row.name).toBe("我的图标");

    const list = await app.inject({ method: "GET", url: "/api/icons", cookies: { sid } });
    expect((list.json() as Array<{ id: string }>).some((r) => r.id === row.id)).toBe(true);

    const file = await app.inject({ method: "GET", url: `/api/icons/${row.id}`, cookies: { sid } });
    expect(file.statusCode).toBe(200);
    expect(String(file.headers["content-type"])).toContain("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(file.headers["content-security-policy"])).toContain("sandbox");

    const del = await app.inject({ method: "DELETE", url: `/api/icons/${row.id}`, cookies: { sid } });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: `/api/icons/${row.id}`, cookies: { sid } });
    expect(gone.statusCode).toBe(404);
  });

  it("SVG 净化：script/事件属性剥离，干净 SVG 保留图形", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onload");
    expect(clean).toContain("<rect");
    expect(looksUnsafeSvg(clean)).toBe(false);
  });

  it("SRV-21: 实体编码的 javascript: 不再绕过（解码检视 + href 按值判定）", () => {
    // 数字实体（十进制/十六进制）藏 j —— 旧字面匹配双重漏检
    expect(looksUnsafeSvg("&#106;avascript:alert(1)")).toBe(true);
    expect(looksUnsafeSvg("&#x6a;avascript:alert(1)")).toBe(true);
    expect(looksUnsafeSvg("javascript&colon;alert(1)")).toBe(true);
    // href 属性值实体编码 → 净化直接清空该 href
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("&#106;");
    expect(clean).toContain('href=""');
    expect(looksUnsafeSvg(clean)).toBe(false);
    // 干净实体内容（&amp; 等）不误伤
    expect(looksUnsafeSvg('<svg><text>Tom &amp; Jerry</text></svg>')).toBe(false);
  });

  it("上传面校验：非法 mime 400、净化后仍危险 400、未登录 401", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/icons",
      cookies: { sid },
      payload: { name: "x", mime: "image/gif", dataBase64: "AAAA" },
    });
    expect(bad.statusCode).toBe(400);

    const svgDirty = await app.inject({
      method: "POST",
      url: "/api/icons",
      cookies: { sid },
      payload: {
        name: "evil",
        mime: "image/svg+xml",
        dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString("base64"),
      },
    });
    // script 剥离后为空 svg —— 不应报错入库但内容已无害；此处断言不带 script 落库
    if (svgDirty.statusCode === 201) {
      const id = (svgDirty.json() as { id: string }).id;
      const file = await app.inject({ method: "GET", url: `/api/icons/${id}`, cookies: { sid } });
      expect(file.body).not.toContain("<script");
    } else {
      expect(svgDirty.statusCode).toBe(400);
    }

    const anon = await app.inject({
      method: "POST",
      url: "/api/icons",
      payload: { name: "x", mime: "image/png", dataBase64: "AAAA" },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe("SRV-09/CON-11：GET /api/icons/:id 归属校验", () => {
  it("别人的图标一律 404（不泄漏存在性）", async () => {
    const foreignId = `u-${randomBytes(6).toString("hex")}`;
    const now = new Date();
    await db.insert(user).values({
      id: foreignId,
      username: `other-${randomBytes(4).toString("hex")}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
    });
    const iconId = `i-${randomBytes(6).toString("hex")}`;
    await db.insert(customIcon).values({
      id: iconId,
      userId: foreignId,
      name: "foreign.png",
      mime: "image/png",
      size: 8,
      createdAt: new Date(),
    });
    const res = await app.inject({ method: "GET", url: `/api/icons/${iconId}`, cookies: { sid } });
    expect(res.statusCode).toBe(404); // 归属校验（修前：200 直出文件）
  });
});
