import type { FastifyInstance } from "fastify";

import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import {
  createCredential,
  deleteCredential,
  listCredentials,
} from "../credentials/store.ts";

/**
 * SEC3 凭证 API：只回 id/name/kind 元数据，明文只进不出（存入即加密）。
 */

const createBody = z.object({
  name: z.string().min(1).max(64),
  kind: z.string().min(1).max(32).default("generic"),
  secret: z.string().min(1).max(4096),
});

export function registerCredentialRoutes(app: FastifyInstance): void {
  app.get("/api/credentials", { preHandler: authGuard }, async (req) => {
    return listCredentials(app.db, req.user!.id);
  });

  app.post("/api/credentials", { preHandler: authGuard }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const view = await createCredential(
      app.db,
      req.user!.id,
      parsed.data.name,
      parsed.data.kind,
      parsed.data.secret,
    );
    return reply.code(201).send(view);
  });

  app.delete("/api/credentials/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const ok = await deleteCredential(app.db, req.user!.id, params.data.id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
