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
  dir = mkdtempSync(join(tmpdir(), "ail-todo-test-"));
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
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
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("todo API (Workspace-level data, D21)", () => {
  let todoId: string;

  it("creates a todo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/todos",
      cookies: { sid },
      payload: { title: "买牛奶", list: "inbox" },
    });
    expect(res.statusCode).toBe(201);
    todoId = res.json().id;
    expect(res.json().title).toBe("买牛奶");
  });

  it("lists and filters by list", async () => {
    await app.inject({
      method: "POST",
      url: "/api/todos",
      cookies: { sid },
      payload: { title: "工作项", list: "work" },
    });
    const all = await app.inject({ method: "GET", url: "/api/todos", cookies: { sid } });
    expect(all.json().length).toBe(2);
    const inbox = await app.inject({ method: "GET", url: "/api/todos?list=inbox", cookies: { sid } });
    expect(inbox.json().length).toBe(1);
    expect(inbox.json()[0].title).toBe("买牛奶");
  });

  it("toggles done (FR-I5 widget action)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todoId}`,
      cookies: { sid },
      payload: { done: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toBe(true);
  });

  it("deletes", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/todos/${todoId}`,
      cookies: { sid },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/todos", cookies: { sid } });
    expect(list.json().length).toBe(1);
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/todos" });
    expect(res.statusCode).toBe(401);
  });

  it("serves todo data via widget data channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "todo", config: { filter: "all" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.items.length).toBe(1);
    expect(body.data.open).toBe(1);
    expect(body.fetchedAt).toBeTruthy();
  });

  it("data channel caches and rate-limits (NFR4)", async () => {
    // unique filter → fresh cache key (previous test already cached filter=all)
    const q = { type: "todo", config: { filter: "cache-test" } };
    const first = await app.inject({ method: "POST", url: "/api/widgets/data", cookies: { sid }, payload: q });
    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);
    const second = await app.inject({ method: "POST", url: "/api/widgets/data", cookies: { sid }, payload: q });
    expect(second.json().cached).toBe(true);
    const forced = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { ...q, force: true },
    });
    // force bypasses TTL but min-interval still applies → cached response or 429
    expect([200, 429]).toContain(forced.statusCode);
  });

  it("rejects unknown widget type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/widgets/data",
      cookies: { sid },
      payload: { type: "nope", config: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("D43: delete-group 真删该组全部任务（跨组不动）", async () => {
    await app.inject({ method: "POST", url: "/api/todos", cookies: { sid }, payload: { title: "g-a1", list: "组甲" } });
    await app.inject({ method: "POST", url: "/api/todos", cookies: { sid }, payload: { title: "g-a2", list: "组甲" } });
    await app.inject({ method: "POST", url: "/api/todos", cookies: { sid }, payload: { title: "g-b1", list: "组乙" } });
    const res = await app.inject({ method: "POST", url: "/api/todos/delete-group", cookies: { sid }, payload: { name: "组甲" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(2);
    const left = await app.inject({ method: "GET", url: "/api/todos?list=组乙", cookies: { sid } });
    expect((left.json() as unknown[]).length).toBe(1);
    const gone = await app.inject({ method: "GET", url: "/api/todos?list=组甲", cookies: { sid } });
    expect((gone.json() as unknown[]).length).toBe(0);
  });
});
