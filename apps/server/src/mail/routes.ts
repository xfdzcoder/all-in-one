import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { SsrfBlockedError } from "../connector/ssrf.ts";
import type { MailClientFactory } from "./client.ts";
import {
  MailError,
  createAccount,
  deleteAccount,
  fetchMessageBody,
  fetchMessages,
  listAccounts,
  updateAccount,
} from "./service.ts";

/**
 * 邮件 REST（Q7a，只读聚合）：账号管理（密码只存凭证引用）+ 聚合列表 + 正文。
 * 无任何写邮箱的端点（D3 只读边界）。
 */

const accountBody = z.object({
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  security: z.enum(["ssl", "starttls", "plain"]).optional(),
  username: z.string().min(1).max(200),
  credentialId: z.string().min(1).max(64).nullish(),
  folder: z.string().min(1).max(120).optional(),
});
const accountPatch = accountBody.partial().refine((o) => Object.keys(o).length > 0, "empty patch");
const idParams = z.object({ id: z.string().min(1).max(64) });
const bodyParams = z.object({
  accountId: z.string().min(1).max(64),
  uid: z.coerce.number().int().min(1),
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  account: z.string().max(64).optional(),
  /** 手动刷新：force=1 穿透列表缓存（FR-I3）。 */
  force: z.string().optional(),
});

export function registerMailRoutes(
  app: FastifyInstance,
  deps: { clientFactory?: MailClientFactory } = {},
): void {
  app.get("/api/mail/accounts", { preHandler: authGuard }, async (req) => {
    return listAccounts(app.db, req.user!.id);
  });

  app.post("/api/mail/accounts", { preHandler: authGuard }, async (req, reply) => {
    const parsed = accountBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const row = await createAccount(app.db, req.user!.id, parsed.data);
    return reply.code(201).send(row);
  });

  app.patch("/api/mail/accounts/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = accountPatch.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const row = await updateAccount(app.db, req.user!.id, params.data.id, body.data);
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.delete("/api/mail/accounts/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const okDel = await deleteAccount(app.db, req.user!.id, params.data.id);
    if (!okDel) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  /** 多账号聚合列表（逐账号错误隔离）。 */
  app.get("/api/mail/messages", { preHandler: authGuard }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    try {
      return await fetchMessages(app.db, req.user!.id, {
        limit: q.data.limit,
        accountIds: q.data.account ? [q.data.account] : undefined,
        clientFactory: deps.clientFactory,
        force: q.data.force === "1",
      });
    } catch (e) {
      if (e instanceof MailError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.get("/api/mail/messages/:accountId/:uid", { preHandler: authGuard }, async (req, reply) => {
    const params = bodyParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    try {
      return await fetchMessageBody(
        app.db,
        req.user!.id,
        params.data.accountId,
        params.data.uid,
        deps.clientFactory,
      );
    } catch (e) {
      if (e instanceof MailError) return reply.code(e.status).send({ error: e.message });
      if (e instanceof SsrfBlockedError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
}
