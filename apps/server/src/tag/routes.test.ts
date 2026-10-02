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
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  dir = mkdtempSync(join(tmpdir(), "ail-tag-test-"));
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

const json = (res: { json: () => unknown }) => res.json() as Record<string, never>;

describe("tags API（FR-D1/D4，D40）", () => {
  let techId = "";
  let homeId = "";

  it("未登录 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tags" });
    expect(res.statusCode).toBe(401);
  });

  it("创建标签：201；同名 409；列表含 targetCount", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/tags",
      cookies: { sid },
      payload: { name: "技术", color: "blue" },
    });
    expect(a.statusCode).toBe(201);
    techId = json(a).id as string;
    const b = await app.inject({
      method: "POST",
      url: "/api/tags",
      cookies: { sid },
      payload: { name: "家研" },
    });
    homeId = json(b).id as string;

    const dup = await app.inject({
      method: "POST",
      url: "/api/tags",
      cookies: { sid },
      payload: { name: "技术" },
    });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: "GET", url: "/api/tags", cookies: { sid } });
    const rows = list.json() as Array<{ id: string; targetCount: number }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.targetCount === 0)).toBe(true);
  });

  it("重命名/改色；未知标签 404", async () => {
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/tags/${techId}`,
      cookies: { sid },
      payload: { name: "技术圈", color: "purple" },
    });
    expect(ok.statusCode).toBe(200);
    const miss = await app.inject({
      method: "PATCH",
      url: "/api/tags/nope",
      cookies: { sid },
      payload: { name: "x" },
    });
    expect(miss.statusCode).toBe(404);
  });

  it("打标签覆盖式设置 + 实体内嵌 tagIds（FR-D3）", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/todos",
      cookies: { sid },
      payload: { title: "tagged-task", list: "inbox" },
    });
    const todoId = json(t).id as string;

    const set1 = await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "todo", targetId: todoId, tagIds: [techId, homeId] },
    });
    expect(set1.statusCode).toBe(200);

    const got = await app.inject({
      method: "GET",
      url: `/api/tags/targets/todo/${todoId}`,
      cookies: { sid },
    });
    expect((json(got).tagIds as string[]).toSorted()).toEqual([techId, homeId].toSorted());

    // 覆盖语义：再设 [homeId] → 只剩一个
    await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "todo", targetId: todoId, tagIds: [homeId] },
    });
    const got2 = await app.inject({
      method: "GET",
      url: `/api/tags/targets/todo/${todoId}`,
      cookies: { sid },
    });
    expect(json(got2).tagIds).toEqual([homeId]);

    // 列表内嵌
    const todos = await app.inject({ method: "GET", url: "/api/todos?list=inbox", cookies: { sid } });
    const rows = todos.json() as Array<{ id: string; tagIds: string[] }>;
    expect(rows.find((r) => r.id === todoId)?.tagIds).toEqual([homeId]);

    // 未知标签 id → 400
    const bad = await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "todo", targetId: todoId, tagIds: ["bogus"] },
    });
    expect(bad.statusCode).toBe(400);

    // 非法 targetType → 400
    const badType = await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "kanban_card", targetId: todoId, tagIds: [] },
    });
    expect(badType.statusCode).toBe(400);

    // 清理：后续用例以 targetCount 0 为基线
    await app.inject({ method: "DELETE", url: `/api/todos/${todoId}`, cookies: { sid } });
  });

  it("删除标签级联删关联；删除 Todo 清理关联（FR-D4 数据边界）", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/todos",
      cookies: { sid },
      payload: { title: "linked-task", list: "inbox" },
    });
    const todoId = json(t).id as string;
    await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "todo", targetId: todoId, tagIds: [techId] },
    });

    // 删标签 → 关联级联消失（FK），Todo 本身保留
    await app.inject({ method: "DELETE", url: `/api/tags/${techId}`, cookies: { sid } });
    const afterTag = await app.inject({
      method: "GET",
      url: `/api/tags/targets/todo/${todoId}`,
      cookies: { sid },
    });
    expect(json(afterTag).tagIds).toEqual([]);
    const todos = await app.inject({ method: "GET", url: "/api/todos?list=inbox", cookies: { sid } });
    expect((todos.json() as Array<{ id: string }>).some((r) => r.id === todoId)).toBe(true);

    // 重新打标 → 删 Todo → 标签计数回落（应用层清理）
    await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "todo", targetId: todoId, tagIds: [homeId] },
    });
    await app.inject({ method: "DELETE", url: `/api/todos/${todoId}`, cookies: { sid } });
    const tags = await app.inject({ method: "GET", url: "/api/tags", cookies: { sid } });
    const home = (tags.json() as Array<{ id: string; targetCount: number }>).find((r) => r.id === homeId);
    expect(home?.targetCount).toBe(0);
  });

  it("RSS 订阅源内嵌 tagIds；删除源清理关联", async () => {
    const src = await app.inject({
      method: "POST",
      url: "/api/feeds",
      cookies: { sid },
      payload: { title: "feed-a", url: "https://example.com/feed-a.xml" },
    });
    const srcId = json(src).id as string;
    await app.inject({
      method: "PUT",
      url: "/api/tags/targets",
      cookies: { sid },
      payload: { targetType: "feed", targetId: srcId, tagIds: [homeId] },
    });
    const feeds = await app.inject({ method: "GET", url: "/api/feeds", cookies: { sid } });
    const row = (feeds.json() as Array<{ id: string; tagIds: string[] }>).find((r) => r.id === srcId);
    expect(row?.tagIds).toEqual([homeId]);

    await app.inject({ method: "DELETE", url: `/api/feeds/${srcId}`, cookies: { sid } });
    const tags = await app.inject({ method: "GET", url: "/api/tags", cookies: { sid } });
    const home = (tags.json() as Array<{ id: string; targetCount: number }>).find((r) => r.id === homeId);
    expect(home?.targetCount).toBe(0);
  });
});
