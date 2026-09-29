import type { FastifyInstance } from "fastify";

import { and, asc, eq } from "drizzle-orm";

import {
  dashboardPatchBody,
  dashboardCreateBody,
  idParams,
  layoutUpdateBody,
  type DashboardCreateBody,
  type DashboardPatchBody,
} from "../api/schemas.ts";
import { authGuard } from "../auth/guard.ts";
import { dashboard, LAYOUT_SCHEMA_VERSION } from "../db/schema.ts";

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, v: unknown): T | null {
  const r = schema.safeParse(v);
  return r.success ? (r.data as T) : null;
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  // All business routes are behind authGuard (M1-④).
  app.get("/api/dashboards", { preHandler: authGuard }, async (req) => {
    const rows = await app.db
      .select()
      .from(dashboard)
      .where(eq(dashboard.userId, req.user!.id))
      .orderBy(asc(dashboard.sortOrder), asc(dashboard.createdAt));
    return rows;
  });

  app.post("/api/dashboards", { preHandler: authGuard }, async (req, reply) => {
    const body = parse<DashboardCreateBody>(dashboardCreateBody, req.body);
    if (!body) return reply.code(400).send({ error: "invalid body" });

    const now = new Date();
    const [row] = await app.db
      .insert(dashboard)
      .values({
        id: crypto.randomUUID(),
        userId: req.user!.id,
        title: body.title,
        icon: body.icon ?? null,
        sortOrder: 0,
        layoutJson: "[]",
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.patch("/api/dashboards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = parse<{ id: string }>(idParams, req.params);
    const body = parse<DashboardPatchBody>(dashboardPatchBody, req.body);
    if (!params || !body) return reply.code(400).send({ error: "invalid request" });

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) set.title = body.title;
    if (body.icon !== undefined) set.icon = body.icon;
    if (body.background !== undefined) set.background = body.background;
    if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;
    if (body.layoutJson !== undefined) {
      set.layoutJson = body.layoutJson;
      set.schemaVersion = LAYOUT_SCHEMA_VERSION;
    }

    const [row] = await app.db
      .update(dashboard)
      .set(set)
      .where(and(eq(dashboard.id, params.id), eq(dashboard.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.delete("/api/dashboards/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = parse<{ id: string }>(idParams, req.params);
    if (!params) return reply.code(400).send({ error: "invalid request" });

    const [row] = await app.db
      .delete(dashboard)
      .where(and(eq(dashboard.id, params.id), eq(dashboard.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  /** M1-⑤ auto-save target: layout only (FR-P4 debounced save from web). */
  app.put("/api/dashboards/:id/layout", { preHandler: authGuard }, async (req, reply) => {
    const params = parse<{ id: string }>(idParams, req.params);
    const body = parse<{ layoutJson: string }>(layoutUpdateBody, req.body);
    if (!params || !body) return reply.code(400).send({ error: "invalid request" });

    const [row] = await app.db
      .update(dashboard)
      .set({
        layoutJson: body.layoutJson,
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        updatedAt: new Date(),
      })
      .where(and(eq(dashboard.id, params.id), eq(dashboard.userId, req.user!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });
}
