import type { FastifyInstance } from "fastify";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { deleteTargetLinks, tagLinksFor } from "../tag/routes.ts";
import { feedRead, feedSource } from "../db/schema.ts";

const createSource = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2000),
});
const idParams = z.object({ id: z.string().min(1).max(64) });
const readBody = z.object({ itemKey: z.string().min(1).max(128) });

/** RSS 订阅源 + 已读标记（Workspace 级，D21）。 */
export function registerFeedRoutes(app: FastifyInstance, onChanged: () => void): void {
  app.get("/api/feeds", { preHandler: authGuard }, async (req) => {
    const rows = await app.db
      .select()
      .from(feedSource)
      .where(eq(feedSource.userId, req.user!.id))
      .orderBy(asc(feedSource.createdAt));
    // FR-D3：内嵌标签（组件按标签选源）
    const links = await tagLinksFor(app.db, req.user!.id, "feed", rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, tagIds: links.get(r.id) ?? [] }));
  });

  app.post("/api/feeds", { preHandler: authGuard }, async (req, reply) => {
    const parsed = createSource.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const [row] = await app.db
      .insert(feedSource)
      .values({
        id: crypto.randomUUID(),
        userId: req.user!.id,
        title: parsed.data.title,
        url: parsed.data.url,
        createdAt: new Date(),
      })
      .returning();
    onChanged();
    return reply.code(201).send(row);
  });

  app.delete("/api/feeds/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const [row] = await app.db
      .delete(feedSource)
      .where(and(eq(feedSource.id, params.data.id), eq(feedSource.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    // D40：多态关联无外键 —— 实体删除时应用层清理
    await deleteTargetLinks(app.db, req.user!.id, "feed", params.data.id);
    onChanged();
    return { ok: true };
  });

  app.post("/api/feeds/read", { preHandler: authGuard }, async (req, reply) => {
    const parsed = readBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const existing = await app.db
      .select({ id: feedRead.id })
      .from(feedRead)
      .where(and(eq(feedRead.userId, req.user!.id), eq(feedRead.itemKey, parsed.data.itemKey)));
    if (existing.length === 0) {
      await app.db.insert(feedRead).values({
        id: crypto.randomUUID(),
        userId: req.user!.id,
        itemKey: parsed.data.itemKey,
        readAt: new Date(),
      }).onConflictDoNothing();
    }
    onChanged();
    return { ok: true };
  });

}
