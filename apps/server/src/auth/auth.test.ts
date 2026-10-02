import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
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
