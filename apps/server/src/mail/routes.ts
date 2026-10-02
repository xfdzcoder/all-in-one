import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { SsrfBlockedError } from "../connector/ssrf.ts";
import type { MailClientFactory } from "./client.ts";
import {
  buildGmailAuthorizeUrl,
  exchangeGmailCode,
  fetchGmailProfile,
} from "./gmail.ts";
import { createCredential } from "../credentials/store.ts";
import {
  MailError,
  createAccount,
  deleteAccount,
  fetchMessageBody,
  fetchMessages,
  listAccounts,
  markMessageRead,
  updateAccount,
} from "./service.ts";

/**
 * 邮件 REST（Q7a，只读聚合）：账号管理（密码只存凭证引用）+ 聚合列表 + 正文。
 * 无任何写**邮箱服务商**的端点（D3 只读边界）；**D64**（用户反馈③）另有**本地**已读
 * 标记端点（未读徽标归 Workspace，服务商 SEEN 不回写）。
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
// Q27a：PATCH 支持 password —— 更新口令 = 换新凭证（旧编辑路径静默丢弃口令，致认证失败）
const accountPatch = accountBody
  .extend({ password: z.string().min(1).max(400).optional() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
const idParams = z.object({ id: z.string().min(1).max(64) });
const bodyParams = z.object({
  accountId: z.string().min(1).max(64),
  /** IMAP UID（数字）或 Gmail 消息 id（字符串）。 */
  uid: z.string().min(1).max(200),
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  account: z.string().max(64).optional(),
  /** WEB-1（Q99c）：多账号过滤下推 —— 逗号分隔；原先前端先取全局 20 封再客户端过滤，
   *  选中单个账号时 20 封里可能没几封属于它 ⇒ 列表近乎空白、limit 语义被过滤破坏。 */
  accountIds: z.string().max(2000).optional(),
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
    const { password, ...rest } = body.data;
    let credentialId = rest.credentialId;
    if (password) {
      // 新口令入凭证库（SEC3），账号改指向新凭证
      const cred = await createCredential(app.db, req.user!.id, `mail-${Date.now()}`, "generic", password);
      credentialId = cred.id;
    }
    const row = await updateAccount(app.db, req.user!.id, params.data.id, { ...rest, credentialId });
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  /** Gmail OAuth 绑定（D37）：返回授权 URL（客户端打开）；state 防 CSRF（内存态，10 分钟有效）。 */
  const gmailStates = new Map<string, { userId: string; redirectUri: string; at: number }>();
  app.post("/api/mail/gmail/authorize", { preHandler: authGuard }, async (req, reply) => {
    const body = z.object({ redirectUri: z.string().url().max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body" });
    const clientId = process.env.GMAIL_CLIENT_ID ?? "";
    const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ error: "未配置 GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET（见 docs/deploy.md）" });
    }
    const state = crypto.randomUUID();
    gmailStates.set(state, { userId: req.user!.id, redirectUri: body.data.redirectUri, at: Date.now() });
    for (const [k, v] of gmailStates) {
      if (Date.now() - v.at > 10 * 60_000) gmailStates.delete(k);
    }
    return { url: buildGmailAuthorizeUrl(clientId, body.data.redirectUri, state) };
  });

  /** OAuth 回调（Google 重定向，无需会话；state 绑定发起用户）。 */
  app.get("/api/mail/gmail/callback", async (req, reply) => {
    const q = z
      .object({
        code: z.string().max(4000).optional(),
        state: z.string().min(1).max(128),
        error: z.string().max(200).optional(),
      })
      .safeParse(req.query);
    const html = (title: string, body: string) =>
      reply.type("text/html; charset=utf-8").send(
        `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#14181f;color:#e8e8e8;padding:2rem"><h3>${title}</h3><p>${body}</p></body>`,
      );
    if (!q.success) return html("绑定失败", "回调参数无效");
    const st = gmailStates.get(q.data.state);
    gmailStates.delete(q.data.state);
    if (!st) return html("绑定失败", "state 无效或已过期，请回到工作台重新发起绑定");
    if (q.data.error) return html("绑定失败", `Google 返回错误：${q.data.error}`);
    if (!q.data.code) return html("绑定失败", "缺少授权码");
    try {
      const tokens = await exchangeGmailCode(
        q.data.code,
        st.redirectUri,
        process.env.GMAIL_CLIENT_ID ?? "",
        process.env.GMAIL_CLIENT_SECRET ?? "",
      );
      if (!tokens.refreshToken) {
        return html("绑定失败", "未获得 refresh_token（Google Cloud 侧需允许离线访问）");
      }
      const profile = await fetchGmailProfile(tokens.accessToken).catch(() => ({ emailAddress: "" }));
      const email = profile.emailAddress || `gmail-${Date.now()}`;
      const cred = await createCredential(app.db, st.userId, `gmail-${email}`, "oauth2", tokens.refreshToken);
      await createAccount(app.db, st.userId, {
        kind: "gmail",
        name: `Gmail · ${email}`,
        host: "gmail",
        port: 0,
        security: "oauth2",
        username: email,
        credentialId: cred.id,
        folder: "INBOX",
      });
      return html("绑定成功", `已接入 ${email}（只读）。可关闭此页回到工作台。`);
    } catch (e) {
      return html("绑定失败", e instanceof Error ? e.message : String(e));
    }
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
        accountIds: q.data.accountIds
          ? q.data.accountIds.split(",").map((x) => x.trim()).filter(Boolean)
          : q.data.account
            ? [q.data.account]
            : undefined,
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

  /** D64（用户反馈③）：标记已读 —— **本地幂等**（未读徽标归 Workspace），
   *  不回写 IMAP SEEN / Gmail UNREAD（D3 只读边界不破）。 */
  app.post("/api/mail/messages/:accountId/:uid/read", { preHandler: authGuard }, async (req, reply) => {
    const params = bodyParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    await markMessageRead(app.db, req.user!.id, params.data.accountId, params.data.uid);
    return { ok: true };
  });
}
