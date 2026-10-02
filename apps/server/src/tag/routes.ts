import type { FastifyInstance } from "fastify";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import type { Db } from "../db/client.ts";
import { tag, tagTarget } from "../db/schema.ts";

/** D40：targetType 白名单 —— 扩展新实体 = 加枚举值（不迁移）。 */
const TAG_TARGET_TYPES = ["todo", "feed"] as const;
export type TagTargetType = (typeof TAG_TARGET_TYPES)[number];

const createBody = z.object({
  name: z.string().min(1).max(64),
  color: z.string().max(32).optional(),
});

const patchBody = z
  .object({
    name: z.string().min(1).max(64).optional(),
    color: z.string().max(32).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

const idParams = z.object({ id: z.string().min(1).max(64) });

const targetsBody = z.object({
  targetType: z.enum(TAG_TARGET_TYPES),
  targetId: z.string().min(1).max(64),
  tagIds: z.array(z.string().min(1).max(64)).max(64),
});

const targetParams = z.object({
  targetType: z.enum(TAG_TARGET_TYPES),
  targetId: z.string().min(1).max(64),
});

/** 目标实体删除时清理关联（D40：SQLite 无多态外键，应用层统一清理）。 */
export async function deleteTargetLinks(
  db: Db,
  userId: string,
  targetType: TagTargetType,
  targetId: string,
): Promise<void> {
  await db
    .delete(tagTarget)
    .where(
      and(
        eq(tagTarget.userId, userId),
        eq(tagTarget.targetType, targetType),
        eq(tagTarget.targetId, targetId),
      ),
    );
}

/** 批量取目标的标签关联（实体列表内嵌 tagIds 用）。 */
export async function tagLinksFor(
  db: Db,
  userId: string,
  targetType: TagTargetType,
  targetIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (targetIds.length === 0) return map;
  const rows = await db
    .select()
    .from(tagTarget)
    .where(
      and(
        eq(tagTarget.userId, userId),
        eq(tagTarget.targetType, targetType),
        inArray(tagTarget.targetId, targetIds),
      ),
    );
  for (const r of rows) {
    const arr = map.get(r.targetId) ?? [];
    arr.push(r.tagId);
    map.set(r.targetId, arr);
  }
  return map;
}

export function registerTagRoutes(app: FastifyInstance): void {
  // GET /api/tags —— 标签列表（含目标计数）
  app.get("/api/tags", { preHandler: authGuard }, async (req) => {
    const userId = req.user!.id;
    const rows = await app.db
      .select()
      .from(tag)
      .where(eq(tag.userId, userId))
      .orderBy(asc(tag.name));
    const counts = await app.db
      .select({ tagId: tagTarget.tagId, n: sql<number>`count(*)` })
      .from(tagTarget)
      .where(eq(tagTarget.userId, userId))
      .groupBy(tagTarget.tagId);
    const countMap = new Map(counts.map((c) => [c.tagId, Number(c.n)]));
    return rows.map((r) => ({ ...r, targetCount: countMap.get(r.id) ?? 0 }));
  });

  // POST /api/tags —— 创建（同用户同名 409）
  app.post("/api/tags", { preHandler: authGuard }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid tag" });
    const userId = req.user!.id;
    const dup = await app.db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.userId, userId), eq(tag.name, parsed.data.name)))
      .limit(1);
    if (dup.length > 0) return reply.code(409).send({ error: "tag name exists" });
    const row = {
      id: crypto.randomUUID(),
      userId,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      createdAt: new Date(),
    };
    await app.db.insert(tag).values(row);
    return reply.code(201).send(row);
  });

  // PATCH /api/tags/:id —— 重命名/改色
  app.patch("/api/tags/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = patchBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const rows = await app.db
      .select()
      .from(tag)
      .where(and(eq(tag.userId, userId), eq(tag.id, params.data.id)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "tag not found" });
    await app.db
      .update(tag)
      .set({ name: body.data.name, color: body.data.color })
      .where(and(eq(tag.userId, userId), eq(tag.id, params.data.id)));
    return { ok: true };
  });

  // DELETE /api/tags/:id —— 级联删关联（FK），业务数据不动（FR-D4）
  app.delete("/api/tags/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const rows = await app.db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.userId, userId), eq(tag.id, params.data.id)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "tag not found" });
    await app.db.delete(tag).where(and(eq(tag.userId, userId), eq(tag.id, params.data.id)));
    return { ok: true };
  });

  // GET /api/tags/targets/:targetType/:targetId —— 取目标的标签
  app.get("/api/tags/targets/:targetType/:targetId", { preHandler: authGuard }, async (req, reply) => {
    const params = targetParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid target" });
    const links = await tagLinksFor(app.db, req.user!.id, params.data.targetType, [params.data.targetId]);
    return { tagIds: links.get(params.data.targetId) ?? [] };
  });

  // PUT /api/tags/targets —— 覆盖式设置目标标签（UI 勾选保存一次成套）
  app.put("/api/tags/targets", { preHandler: authGuard }, async (req, reply) => {
    const parsed = targetsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const { targetType, targetId, tagIds } = parsed.data;
    const unique = [...new Set(tagIds)];
    if (unique.length > 0) {
      const owned = await app.db
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.userId, userId), inArray(tag.id, unique)));
      if (owned.length !== unique.length) return reply.code(400).send({ error: "unknown tag id" });
    }
    await deleteTargetLinks(app.db, userId, targetType, targetId);
    if (unique.length > 0) {
      await app.db.insert(tagTarget).values(
        unique.map((tagId) => ({ tagId, targetType, targetId, userId })),
      );
    }
    return { ok: true, tagIds: unique };
  });
}
