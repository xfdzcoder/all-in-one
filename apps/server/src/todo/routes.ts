import type { FastifyInstance } from "fastify";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { tagTarget, todo } from "../db/schema.ts";
import { deleteTargetLinks, tagLinksFor } from "../tag/routes.ts";

const createBody = z.object({
  title: z.string().min(1).max(500),
  list: z.string().min(1).max(64).default("inbox"),
});

const patchBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    done: z.boolean().optional(),
    archived: z.boolean().optional(),
    list: z.string().min(1).max(64).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

const idParams = z.object({ id: z.string().min(1).max(64) });

export function registerTodoRoutes(app: FastifyInstance, onChanged: () => void): void {
  // GET /api/todos?list=xxx — Workspace 级数据（D21：user_id 归属）
  app.get("/api/todos", { preHandler: authGuard }, async (req) => {
    const q = (typeof req.query === "object" && req.query) ? (req.query as Record<string, unknown>) : {};
    const includeArchived = q.includeArchived === "1";
    const list = q.list != null ? String(q.list) : undefined;
    // FR-D3/D40：组件按标签选数据 —— 服务端过滤（OR 语义，逗号分隔；空 = 全部）
    const tagIds = typeof q.tagIds === "string" && q.tagIds
      ? q.tagIds.split(",").map((x) => x.trim()).filter(Boolean)
      : [];
    const conds = [eq(todo.userId, req.user!.id)];
    if (list) conds.push(eq(todo.list, list));
    if (!includeArchived) conds.push(eq(todo.archived, false)); // Q29b：归档项仅管理面可见
    const where = and(...conds);
    let rows = await app.db
      .select()
      .from(todo)
      .where(where)
      .orderBy(asc(todo.sortOrder), asc(todo.createdAt));
    if (tagIds.length > 0) {
      const linked = await app.db
        .select({ targetId: tagTarget.targetId })
        .from(tagTarget)
        .where(
          and(
            eq(tagTarget.userId, req.user!.id),
            eq(tagTarget.targetType, "todo"),
            inArray(tagTarget.tagId, tagIds),
          ),
        );
      const allow = new Set(linked.map((l) => l.targetId));
      rows = rows.filter((r) => allow.has(r.id));
    }
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
    if (body.data.archived !== undefined) set.archived = body.data.archived; // Q29b

    const [row] = await app.db
      .update(todo)
      .set(set)
      .where(and(eq(todo.id, params.data.id), eq(todo.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    onChanged();
    return row;
  });

  // D43：删除分组（卡片名称）= 真删该组全部任务（调用方需二次确认）
  app.post("/api/todos/delete-group", { preHandler: authGuard }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request" });
    const rows = await app.db
      .delete(todo)
      .where(and(eq(todo.userId, req.user!.id), eq(todo.list, parsed.data.name)))
      .returning({ id: todo.id });
    // SRV-23：整组真删同样清 tag_target（D40 多态关联无外键，应用层清理）——原实现漏清致孤儿关联
    for (const r of rows) await deleteTargetLinks(app.db, req.user!.id, "todo", r.id);
    onChanged();
    return { ok: true, deleted: rows.length };
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
