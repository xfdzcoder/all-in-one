import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
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
