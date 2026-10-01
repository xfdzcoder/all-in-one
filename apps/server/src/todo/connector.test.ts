import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { todo } from "../db/schema.ts";
import { todoConnector } from "./connector.ts";
import type { FetchContext } from "../connector/registry.ts";

let dir: string;
let client: Client;
let db: Db;
let ctx: FetchContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-todo-conn-test-"));
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  const [u] = await db.query.user.findMany();
  ctx = {
    db,
    userId: u!.id,
    readSecret: async () => {
      throw new Error("no secrets in this test");
    },
  };
  const now = new Date();
  await db.insert(todo).values([
    { id: "t-open", userId: ctx.userId, list: "inbox", title: "未完成", done: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: "t-done", userId: ctx.userId, list: "inbox", title: "已完成", done: true, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: "t-arch", userId: ctx.userId, list: "inbox", title: "已归档", done: false, sortOrder: 2, createdAt: now, updatedAt: now },
  ]);
  await db.update(todo).set({ archived: true }).where(eq(todo.id, "t-arch"));
});

afterAll(async () => {
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("todo connector（SRV-10：归档语义与 REST/文档一致）", () => {
  it("归档项不进组件数据（数据源管理走 REST includeArchived 才可见）", async () => {
    const out = (await todoConnector.fetch({ type: "todo", config: { list: "inbox", filter: "all" } }, ctx)) as {
      items: Array<{ id: string }>;
    };
    const ids = out.items.map((i) => i.id);
    expect(ids).toContain("t-open");
    expect(ids).toContain("t-done");
    expect(ids).not.toContain("t-arch");
  });

  it("不带 list 的查询同样排除归档", async () => {
    const out = (await todoConnector.fetch({ type: "todo", config: {} }, ctx)) as { items: Array<{ id: string }> };
    expect(out.items.map((i) => i.id)).not.toContain("t-arch");
  });
});
