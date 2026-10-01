import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-refresh-test-"));
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  ({ client, db } = await createDb(`file:${join(dir, `r-${randomBytes(4).toString("hex")}.db`)}`));
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
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

// 注意：sid 在 beforeAll 里才有值 —— 必须惰性取，不能在模块求值时固化
const auth = () => ({ cookie: `sid=${sid}` });
const queryData = (force?: boolean) =>
  app.inject({
    method: "POST",
    url: "/api/widgets/data",
    headers: auth(),
    payload: { type: "todo", config: { list: "refresh-test" }, ...(force ? { force: true } : {}) },
  });
const bodyOf = async (force?: boolean) =>
  JSON.parse((await queryData(force)).body) as { data: unknown; fetchedAt: string; cached: boolean };

/**
 * Q87（项 4）：用户报「点刷新按钮没反应」。
 * 根因两层 —— ① 前端 `query.refetch()` 不带 `force`（永远命中 60s TTL）；
 * ② 服务端即使带了 `force`，也只跳过缓存**读**，仍被 `minIntervalSec` 限流挡回旧数据。
 * 本用例锁住服务端这一半。
 *
 * 注意：todo 写操作会 `cache.clear()`（app.ts，变更即失效），所以取数都放在
 * 最后一次写之后，否则缓存被清掉、TTL 分支根本进不去。
 */
describe("手动刷新必须穿透缓存（FR-I3 / Q87 项 4）", () => {
  it("force 同时绕过 TTL 缓存读与 minIntervalSec 限流", async () => {
    const added = await app.inject({
      method: "POST",
      url: "/api/todos",
      headers: auth(),
      payload: { title: "t1", list: "refresh-test" },
    });
    expect(added.statusCode).toBe(201);

    // ① 首次：回源
    const first = await bodyOf();
    expect(first.cached).toBe(false);
    expect((first.data as { items: unknown[] }).items.length).toBe(1);

    // ② 二次（无变更）：TTL 内必须回缓存
    const cached = await bodyOf();
    expect(cached.cached).toBe(true);
    expect(JSON.stringify(cached.data)).toBe(JSON.stringify(first.data));

    // ③ 手动刷新 = force。此刻距 ① 回源远小于 minIntervalSec(5s)：
    // 若 force 没绕过限流，这里会被 allowFetch 挡下、返回 ② 的缓存（cached: true）。
    const forced = await bodyOf(true);
    expect(forced.cached).toBe(false);
    expect(forced.fetchedAt >= first.fetchedAt).toBe(true);
  });
});
