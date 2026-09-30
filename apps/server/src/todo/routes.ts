import type { FastifyInstance } from "fastify";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { todo } from "../db/schema.ts";
import { deleteTargetLinks, tagLinksFor } from "../tag/routes.ts";

const createBody = z.object({
  title: z.string().min(1).max(500),
  list: z.string().min(1).max(64).default("inbox"),
});

const patchBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    done: z.boolean().optional(),
    list: z.string().min(1).max(64).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

const idParams = z.object({ id: z.string().min(1).max(64) });

export function registerTodoRoutes(app: FastifyInstance, onChanged: () => void): void {
  // GET /api/todos?list=xxx — Workspace 级数据（D21：user_id 归属）
  app.get("/api/todos", { preHandler: authGuard }, async (req) => {
    const list = typeof req.query === "object" && req.query && "list" in req.query
      ? String((req.query as Record<string, unknown>).list)
      : undefined;
    const where = list
      ? and(eq(todo.userId, req.user!.id), eq(todo.list, list))
      : eq(todo.userId, req.user!.id);
    const rows = await app.db
      .select()
      .from(todo)
      .where(where)
      .orderBy(asc(todo.sortOrder), asc(todo.createdAt));
    // FR-D3：内嵌标签（组件按标签选数据；管理面打标签展示）
    const links = await tagLinksFor(app.db, req.user!.id, "todo", rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, tagIds: links.get(r.id) ?? [] }));
  });

  app.post("/api/todos", { preHandler: authGuard }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const now = new Date();
    const [row] = await app.db
      .insert(todo)
      .values({
        id: crypto.randomUUID(),
        userId: req.user!.id,
        title: parsed.data.title,
        list: parsed.data.list,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    onChanged();
    return reply.code(201).send(row);
  });

  app.patch("/api/todos/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = patchBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.title !== undefined) set.title = body.data.title;
    if (body.data.done !== undefined) set.done = body.data.done;
    if (body.data.list !== undefined) set.list = body.data.list;
    if (body.data.sortOrder !== undefined) set.sortOrder = body.data.sortOrder;

    const [row] = await app.db
      .update(todo)
      .set(set)
      .where(and(eq(todo.id, params.data.id), eq(todo.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return row;
  });

  app.delete("/api/todos/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .delete(todo)
      .where(and(eq(todo.id, params.data.id), eq(todo.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    // D40：多态关联无外键 —— 实体删除时应用层清理
    await deleteTargetLinks(app.db, req.user!.id, "todo", params.data.id);
    onChanged();
    return { ok: true };
  });
}
