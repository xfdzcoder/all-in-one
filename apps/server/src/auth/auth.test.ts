import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { user } from "../db/schema.ts";
import { ensureInitialUser } from "./ensure-user.ts";
import { buildApp } from "../app.ts";
import type { FastifyInstance } from "fastify";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;

const ADMIN_PASSWORD = "test-admin-password-123";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-auth-test-"));
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  app = buildApp({ db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth (SEC1/SEC2, D17)", () => {
  it("health is public", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("logs in and sets httpOnly session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "sid");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
  });

  it("rejects wrong password with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unknown user with 401 (same shape as wrong password)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ghost", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid credentials");
  });

  it("returns current user with valid session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: ADMIN_PASSWORD },
    });
    const sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { sid } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe("admin");
  });

  it("rejects /me without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: ADMIN_PASSWORD },
    });
    const sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { sid } });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { sid } });
    expect(me.statusCode).toBe(401);
  });
});

describe("initial account (D17)", () => {
  it("fails fast without ADMIN_PASSWORD when no account exists", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "ail-init-test-"));
    const saved = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    const { client: c2, db: d } = await createDb(
      `file:${join(d2, `t-${randomBytes(4).toString("hex")}.db`)}`,
    );
    await ensureSchema(d);
    await expect(ensureInitialUser(d)).rejects.toThrow(/ADMIN_PASSWORD/);
    if (saved !== undefined) process.env.ADMIN_PASSWORD = saved;
    c2.close();
    rmSync(d2, { recursive: true, force: true });
  });

  it("is idempotent (second call does not create another user)", async () => {
    const again = await ensureInitialUser(db);
    expect(again.created).toBe(false);
  });
});

describe("CON-2：login zod 接线（长度上限真实生效）", () => {
  it("超长 username/password 400（不再进 argon2）", async () => {
    const over = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "a".repeat(200), password: "b".repeat(200) },
    });
    expect(over.statusCode).toBe(400);
    const overPw = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "b".repeat(1000) },
    });
    expect(overPw.statusCode).toBe(400);
  });
});

describe("FR-S2（Q110）：改用户名 / 改密码（必须验证当前密码）", () => {
  const doLogin = (u: string, p: string) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u, password: p } });
  let sid = "";
  let otherSid = "";

  it("未登录 401（两个端点都要会话）", async () => {
    for (const url of ["/api/auth/change-username", "/api/auth/change-password"]) {
      const res = await app.inject({
        method: "POST",
        url,
        payload: { currentPassword: ADMIN_PASSWORD, username: "x", newPassword: "abcdefgh" },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it("改用户名：当前密码不对 401；正确则改成功且会话不断", async () => {
    const a = await doLogin("admin", ADMIN_PASSWORD);
    sid = a.cookies.find((c) => c.name === "sid")?.value ?? "";
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/change-username",
      cookies: { sid },
      payload: { currentPassword: "wrong-password", username: "admin2" },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/change-username",
      cookies: { sid },
      payload: { currentPassword: ADMIN_PASSWORD, username: "admin2" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().username).toBe("admin2");
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { sid } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe("admin2");
  });

  it("改用户名：同名占用 409（不误伤「改成自己现名」）", async () => {
    const same = await app.inject({
      method: "POST",
      url: "/api/auth/change-username",
      cookies: { sid },
      payload: { currentPassword: ADMIN_PASSWORD, username: "admin2" },
    });
    expect(same.statusCode).toBe(200); // 改成自己现名 = 幂等放行
    await db.insert(user).values({
      id: "u-test-dup",
      username: "taken-name",
      passwordHash: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const dup = await app.inject({
      method: "POST",
      url: "/api/auth/change-username",
      cookies: { sid },
      payload: { currentPassword: ADMIN_PASSWORD, username: "taken-name" },
    });
    expect(dup.statusCode).toBe(409);
    await db.delete(user).where(eq(user.id, "u-test-dup"));
  });

  it("改密码：缺字段 400（长度下限与登录一致，不另设）；当前密码不对 401", async () => {
    const short = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { sid },
      payload: { currentPassword: ADMIN_PASSWORD },
    });
    expect(short.statusCode).toBe(400);
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { sid },
      payload: { currentPassword: "wrong-password", newPassword: "brand-new-pass-1" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("改密码成功：旧口令失效、其它会话吊销、当前会话保留", async () => {
    const b = await doLogin("admin2", ADMIN_PASSWORD);
    otherSid = b.cookies.find((c) => c.name === "sid")?.value ?? "";
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { sid },
      payload: { currentPassword: ADMIN_PASSWORD, newPassword: "brand-new-pass-1" },
    });
    expect(res.statusCode).toBe(200);
    expect((await doLogin("admin2", ADMIN_PASSWORD)).statusCode).toBe(401); // 旧口令失效
    expect((await doLogin("admin2", "brand-new-pass-1")).statusCode).toBe(200); // 新口令可登录
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: { sid } })).statusCode).toBe(200); // 当前会话保留
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: { sid: otherSid } })).statusCode).toBe(401); // 其它会话吊销
  });

  it("恢复现场（admin / ADMIN_PASSWORD）", async () => {
    const r1 = await app.inject({
      method: "POST",
      url: "/api/auth/change-username",
      cookies: { sid },
      payload: { currentPassword: "brand-new-pass-1", username: "admin" },
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { sid },
      payload: { currentPassword: "brand-new-pass-1", newPassword: ADMIN_PASSWORD },
    });
    expect(r2.statusCode).toBe(200);
    expect((await doLogin("admin", ADMIN_PASSWORD)).statusCode).toBe(200);
  });
});
