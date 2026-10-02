import type { FastifyInstance } from "fastify";

import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";

import { authGuard } from "../auth/guard.ts";
import { kanbanBoard, kanbanCard, kanbanColumn } from "../db/schema.ts";

/**
 * Kanban REST（二期 Q6a，01 §2.3 多项目看板 / 06 §1）。
 * 数据归 Workspace（D21：user_id 代位）；写操作统一失效缓存 + SSE 广播（FR-I6，
 * 任一组件改看板，其余组件同步）。卡片移动 = PATCH columnId + sortOrder（列内排序
 * 由调用方给出整列新顺序）。
 */

const titleBody = z.object({ title: z.string().min(1).max(200) });
const idParams = z.object({ id: z.string().min(1).max(64) });
const boardCreateBody = titleBody;
const columnCreateBody = z.object({
  boardId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
});
const columnPatchBody = z
  .object({
    title: z.string().min(1).max(120).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");
const cardCreateBody = z.object({
  columnId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
});
const cardPatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(4000).optional(),
    columnId: z.string().min(1).max(64).optional(),
    sortOrder: z.number().int().min(0).optional(),
    archived: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

/** 默认空回调（consistent-function-scoping：不必在函数参数位新建） */
const noop = () => {};

/** 取请求归属用户（纯函数上提模块级） */
const userId = (req: { user?: { id: string } }) => req.user!.id;

export function registerKanbanRoutes(
  app: FastifyInstance,
  onChanged: () => void = noop,
): void {

  // ---- boards -------------------------------------------------------------
  app.get("/api/kanban/boards", { preHandler: authGuard }, async (req) => {
    return app.db
      .select()
      .from(kanbanBoard)
      .where(eq(kanbanBoard.userId, userId(req)))
      .orderBy(asc(kanbanBoard.createdAt));
  });

  /** 看板全量树：columns（有序）+ cards（有序，含归档）。 */
  app.get("/api/kanban/boards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const boards = await app.db
      .select()
      .from(kanbanBoard)
      .where(and(eq(kanbanBoard.id, params.data.id), eq(kanbanBoard.userId, userId(req))))
      .limit(1);
    const board = boards[0];
    if (!board) return reply.code(404).send({ error: "not found" });
    const columns = await app.db
      .select()
      .from(kanbanColumn)
      .where(eq(kanbanColumn.boardId, board.id))
      .orderBy(asc(kanbanColumn.sortOrder), asc(kanbanColumn.createdAt));
    const cards = await app.db
      .select()
      .from(kanbanCard)
      .where(eq(kanbanCard.boardId, board.id))
      .orderBy(asc(kanbanCard.sortOrder), asc(kanbanCard.createdAt));
    return { board, columns, cards };
  });

  app.post("/api/kanban/boards", { preHandler: authGuard }, async (req, reply) => {
    const parsed = boardCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const now = new Date();
    const [row] = await app.db
      .insert(kanbanBoard)
      .values({ id: crypto.randomUUID(), userId: userId(req), title: parsed.data.title, createdAt: now, updatedAt: now })
      .returning();
    onChanged();
    return reply.code(201).send(row);
  });

  app.patch("/api/kanban/boards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = titleBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .update(kanbanBoard)
      .set({ title: body.data.title, updatedAt: new Date() })
      .where(and(eq(kanbanBoard.id, params.data.id), eq(kanbanBoard.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return row;
  });

  app.delete("/api/kanban/boards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .delete(kanbanBoard)
      .where(and(eq(kanbanBoard.id, params.data.id), eq(kanbanBoard.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return { ok: true };
  });

  // ---- columns ------------------------------------------------------------
  app.post("/api/kanban/columns", { preHandler: authGuard }, async (req, reply) => {
    const parsed = columnCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const boards = await app.db
      .select({ id: kanbanBoard.id })
      .from(kanbanBoard)
      .where(and(eq(kanbanBoard.id, parsed.data.boardId), eq(kanbanBoard.userId, userId(req))))
      .limit(1);
    if (boards.length === 0) return reply.code(404).send({ error: "board not found" });
    const now = new Date();
    const [row] = await app.db
      .insert(kanbanColumn)
      .values({
        id: crypto.randomUUID(),
        userId: userId(req),
        boardId: parsed.data.boardId,
        title: parsed.data.title,
        sortOrder: parsed.data.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    onChanged();
    return reply.code(201).send(row);
  });

  app.patch("/api/kanban/columns/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = columnPatchBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.title !== undefined) set.title = body.data.title;
    if (body.data.sortOrder !== undefined) set.sortOrder = body.data.sortOrder;
    const [row] = await app.db
      .update(kanbanColumn)
      .set(set)
      .where(and(eq(kanbanColumn.id, params.data.id), eq(kanbanColumn.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return row;
  });

  app.delete("/api/kanban/columns/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .delete(kanbanColumn)
      .where(and(eq(kanbanColumn.id, params.data.id), eq(kanbanColumn.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return { ok: true };
  });

  // ---- cards --------------------------------------------------------------
  app.post("/api/kanban/cards", { preHandler: authGuard }, async (req, reply) => {
    const parsed = cardCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const columns = await app.db
      .select()
      .from(kanbanColumn)
      .where(and(eq(kanbanColumn.id, parsed.data.columnId), eq(kanbanColumn.userId, userId(req))))
      .limit(1);
    const column = columns[0];
    if (!column) return reply.code(404).send({ error: "column not found" });
    const now = new Date();
    const [row] = await app.db
      .insert(kanbanCard)
      .values({
        id: crypto.randomUUID(),
        userId: userId(req),
        boardId: column.boardId,
        columnId: column.id,
        title: parsed.data.title,
        body: parsed.data.body ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    onChanged();
    return reply.code(201).send(row);
  });

  app.patch("/api/kanban/cards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = cardPatchBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });

    // 换列（卡片移动）时校验目标列同属一个看板
    if (body.data.columnId !== undefined) {
      const target = await app.db
        .select()
        .from(kanbanColumn)
        .where(and(eq(kanbanColumn.id, body.data.columnId), eq(kanbanColumn.userId, userId(req))))
        .limit(1);
      if (target.length === 0) return reply.code(404).send({ error: "column not found" });
      const cards = await app.db
        .select({ boardId: kanbanCard.boardId })
        .from(kanbanCard)
        .where(and(eq(kanbanCard.id, params.data.id), eq(kanbanCard.userId, userId(req))))
        .limit(1);
      if (cards.length === 0) return reply.code(404).send({ error: "not found" });
      if (cards[0].boardId !== target[0].boardId) {
        return reply.code(400).send({ error: "target column belongs to another board" });
      }
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.title !== undefined) set.title = body.data.title;
    if (body.data.body !== undefined) set.body = body.data.body;
    if (body.data.columnId !== undefined) set.columnId = body.data.columnId;
    if (body.data.sortOrder !== undefined) set.sortOrder = body.data.sortOrder;
    if (body.data.archived !== undefined) set.archived = body.data.archived;
    const [row] = await app.db
      .update(kanbanCard)
      .set(set)
      .where(and(eq(kanbanCard.id, params.data.id), eq(kanbanCard.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return row;
  });

  app.delete("/api/kanban/cards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .delete(kanbanCard)
      .where(and(eq(kanbanCard.id, params.data.id), eq(kanbanCard.userId, userId(req))))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return { ok: true };
  });
}
