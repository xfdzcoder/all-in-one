import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { eq } from "drizzle-orm";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { kanbanBoard, kanbanCard, kanbanColumn } from "../db/schema.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

type InjectMethod = "GET" | "POST" | "PATCH" | "DELETE";

const req = (
  method: InjectMethod,
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> => {
  const opts: InjectOptions = { method, url, cookies: { sid } };
  if (payload !== undefined) opts.payload = payload as InjectOptions["payload"];
  return app.inject(opts);
};

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");

  dir = mkdtempSync(join(tmpdir(), "ail-kanban-test-"));
  const dbUrl = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = dbUrl;
  ({ client, db } = await createDb(dbUrl));
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

describe("kanban REST (Q6a: boards / columns / cards)", () => {
  let boardA = "";
  let boardB = "";
  let colTodo = "";
  let colDoing = "";
  let card = "";

  it("creates boards and lists them", async () => {
    const a = await req("POST", "/api/kanban/boards", { title: "项目 A" });
    const b = await req("POST", "/api/kanban/boards", { title: "项目 B" });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    boardA = a.json().id;
    boardB = b.json().id;

    const list = await req("GET", "/api/kanban/boards");
    expect(list.json().map((x: { title: string }) => x.title)).toEqual(
      expect.arrayContaining(["项目 A", "项目 B"]),
    );
  });

  it("adds ordered columns and returns the board tree", async () => {
    const c1 = await req("POST", "/api/kanban/columns", { boardId: boardA, title: "待办", sortOrder: 0 });
    const c2 = await req("POST", "/api/kanban/columns", { boardId: boardA, title: "进行中", sortOrder: 1 });
    expect(c1.statusCode).toBe(201);
    colTodo = c1.json().id;
    colDoing = c2.json().id;

    const tree = await req("GET", `/api/kanban/boards/${boardA}`);
    expect(tree.json().columns.map((c: { title: string }) => c.title)).toEqual(["待办", "进行中"]);
    expect(tree.json().cards).toEqual([]);
  });

  it("creates cards and moves a card across columns (columnId + sortOrder)", async () => {
    const created = await req("POST", "/api/kanban/cards", {
      columnId: colTodo,
      title: "写方案",
      body: "草稿要点",
    });
    expect(created.statusCode).toBe(201);
    card = created.json().id;

    const moved = await req("PATCH", `/api/kanban/cards/${card}`, {
      columnId: colDoing,
      sortOrder: 0,
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().columnId).toBe(colDoing);

    const tree = await req("GET", `/api/kanban/boards/${boardA}`);
    const doing = tree.json().cards.filter((c: { columnId: string }) => c.columnId === colDoing);
    expect(doing).toHaveLength(1);
    expect(doing[0].title).toBe("写方案");
    expect(doing[0].body).toBe("草稿要点");
  });

  it("archives a card without deleting it", async () => {
    const res = await req("PATCH", `/api/kanban/cards/${card}`, { archived: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().archived).toBe(true);
    const rows = await db.select().from(kanbanCard).where(eq(kanbanCard.id, card));
    expect(rows).toHaveLength(1);
  });

  it("rejects moving a card to a column of another board", async () => {
    const colB = await req("POST", "/api/kanban/columns", { boardId: boardB, title: "其它" });
    const res = await req("PATCH", `/api/kanban/cards/${card}`, { columnId: colB.json().id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("another board");
  });

  it("cascades: column delete removes its cards", async () => {
    const res = await req("DELETE", `/api/kanban/columns/${colDoing}`);
    expect(res.statusCode).toBe(200);
    const rows = await db.select().from(kanbanCard).where(eq(kanbanCard.id, card));
    expect(rows).toHaveLength(0);
  });

  it("cascades: board delete removes columns and cards", async () => {
    await req("POST", "/api/kanban/cards", { columnId: colTodo, title: "将随看板删除" });
    const res = await req("DELETE", `/api/kanban/boards/${boardA}`);
    expect(res.statusCode).toBe(200);
    const columns = await db.select().from(kanbanColumn).where(eq(kanbanColumn.boardId, boardA));
    const cards = await db.select().from(kanbanCard).where(eq(kanbanCard.boardId, boardA));
    expect(columns).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });

  it("404s on unknown ids and rejects invalid bodies", async () => {
    expect((await req("GET", "/api/kanban/boards/nope")).statusCode).toBe(404);
    expect((await req("DELETE", "/api/kanban/cards/nope")).statusCode).toBe(404);
    expect((await req("POST", "/api/kanban/boards", { title: "" })).statusCode).toBe(400);
    expect((await req("PATCH", "/api/kanban/cards/x", {})).statusCode).toBe(400);
    const leftover = await db.select().from(kanbanBoard);
    expect(leftover.map((b) => b.title)).toEqual(["项目 B"]);
  });
});
