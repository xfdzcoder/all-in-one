import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import type { FastifyInstance } from "fastify";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  dir = mkdtempSync(join(tmpdir(), "ail-styles-test-"));
  // FR-S3（Q111）：dataDir 由 DATABASE_URL 派生 —— 备份/回滚都落这个目录
  process.env.DATABASE_URL = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  ({ client, db } = await createDb(process.env.DATABASE_URL));
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
  delete process.env.DATABASE_URL;
  rmSync(dir, { recursive: true, force: true });
});

describe("自定义 CSS 读写 + 历史备份/回滚（FR-S3/Q111）", () => {
  it("未登录 401（读写都要会话）", async () => {
    expect((await app.inject({ method: "GET", url: "/api/styles/custom-css" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "PUT", url: "/api/styles/custom-css", payload: { css: "x{}" } })).statusCode,
    ).toBe(401);
  });

  it("保存 → 读回 → 再保存自动留备份 → 回滚恢复旧内容", async () => {
    const a = await app.inject({
      method: "PUT",
      url: "/api/styles/custom-css",
      cookies: { sid },
      payload: { css: ":root { --wb-color-accent: hotpink; }" },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json().backupId).toBeNull(); // 首次保存（原来没有内容）无需备份

    const get1 = await app.inject({ method: "GET", url: "/api/styles/custom-css", cookies: { sid } });
    expect(get1.json().css).toContain("hotpink");

    // 第二次保存：旧版进历史
    const b = await app.inject({
      method: "PUT",
      url: "/api/styles/custom-css",
      cookies: { sid },
      payload: { css: ":root { --wb-color-accent: teal; }" },
    });
    const backupId = b.json().backupId as string;
    expect(backupId).toBeTruthy();
    expect((b.json().backups as unknown[]).length).toBe(1);

    // 回滚：内容回到 hotpink 版（回滚前当前版也备份 → 历史变 2）
    const r = await app.inject({
      method: "POST",
      url: "/api/styles/custom-css/restore",
      cookies: { sid },
      payload: { id: backupId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().css).toContain("hotpink");
    expect((r.json().backups as unknown[]).length).toBe(2);

    const get2 = await app.inject({ method: "GET", url: "/api/styles/custom-css", cookies: { sid } });
    expect(get2.json().css).toContain("hotpink");
  });

  it("非法备份 id 拒绝（400）；不存在的 id 404 —— 不接受路径参数，防穿越", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/styles/custom-css/restore",
      cookies: { sid },
      payload: { id: "../../etc/passwd" },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST",
      url: "/api/styles/custom-css/restore",
      cookies: { sid },
      payload: { id: "2026-01-01T00-00-00-000Z-deadbe" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("超大 CSS 400（256KB 上限）", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/styles/custom-css",
      cookies: { sid },
      payload: { css: "a".repeat(300_000) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("历史封顶 20 份（超出删最旧）", async () => {
    for (let i = 0; i < 25; i++) {
      await app.inject({
        method: "PUT",
        url: "/api/styles/custom-css",
        cookies: { sid },
        payload: { css: `/* v${i} */` },
      });
    }
    const get = await app.inject({ method: "GET", url: "/api/styles/custom-css", cookies: { sid } });
    expect((get.json().backups as unknown[]).length).toBe(20);
    expect(existsSync(join(dir, "custom-css-history"))).toBe(true);
    writeFileSync(join(dir, "custom.css"), "/* untouched */", "utf8");
  });
});
