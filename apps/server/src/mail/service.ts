import { and, asc, eq } from "drizzle-orm";

import { assertSafeOutboundUrl, SsrfBlockedError } from "../connector/ssrf.ts";
import { config } from "../config.ts";
import { readSecret } from "../credentials/store.ts";
import type { Db } from "../db/client.ts";
import { mailAccount, type MailAccount } from "../db/schema.ts";
import type {
  MailClient,
  MailClientFactory,
  MailConnectionConfig,
  MailMessageFull,
  MailMessageSummary,
} from "./client.ts";
import { createImapClient } from "./imap.ts";
import { createGmailClient } from "./gmail.ts";

/** 账号类型 → 客户端（imap / gmail-OAuth，D37）；password 位按类型承载密码或 refresh_token。 */
export function createMailClient(conn: MailConnectionConfig): MailClient {
  if (conn.kind === "gmail") return createGmailClient(conn);
  return createImapClient(conn);
}

/** 组装连接配置（凭证解密值仅在连接期驻留内存；SEC3 不变）。 */
function connOf(account: MailAccount, password: string): MailConnectionConfig {
  return {
    host: account.host,
    port: account.port,
    security: account.security,
    username: account.username,
    password,
    kind: account.kind ?? "imap",
    refreshToken: password,
    clientId: process.env.GMAIL_CLIENT_ID ?? "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? "",
  };
}

/**
 * 邮件只读聚合服务（Q7a）：多账号列表聚合（逐账号错误隔离，同 RSS connector 风格）、
 * 正文拉取与体积截断。SEC3：密码只在拉取时从凭证库解密入内存；SEC4：IMAP 目标
 * 同样过 SSRF 基线（allowPrivateOutbound 逃生阀同 HTTP）；D3：只读，无 IMAP 写操作。
 */

export class MailError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MailError";
    this.status = status;
  }
}

export const TEXT_CAP = 100_000;
export const HTML_CAP = 200_000;
export const LIST_TTL_MS = 60_000;

const listCache = new Map<string, { at: number; items: MailMessageSummary[] }>();

/** 测试可清缓存。 */
export function clearMailCache(): void {
  listCache.clear();
}

export interface MailAccountInput {
  kind?: string;
  name: string;
  host: string;
  port?: number;
  security?: string;
  username: string;
  credentialId?: string | null;
  folder?: string;
}

export async function listAccounts(db: Db, userId: string): Promise<MailAccount[]> {
  return db
    .select()
    .from(mailAccount)
    .where(eq(mailAccount.userId, userId))
    .orderBy(asc(mailAccount.createdAt));
}

async function ownedAccount(
  db: Db,
  userId: string,
  id: string,
): Promise<MailAccount | null> {
  const rows = await db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.id, id), eq(mailAccount.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAccount(
  db: Db,
  userId: string,
  input: MailAccountInput,
): Promise<MailAccount> {
  const now = new Date();
  const [row] = await db
    .insert(mailAccount)
    .values({
      id: crypto.randomUUID(),
      userId,
      name: input.name,
      kind: input.kind ?? "imap",
      host: input.host,
      port: input.port ?? 993,
      security: input.security ?? "ssl",
      username: input.username,
      credentialId: input.credentialId ?? null,
      folder: input.folder ?? "INBOX",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<MailAccountInput>,
): Promise<MailAccount | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.host !== undefined) set.host = patch.host;
  if (patch.port !== undefined) set.port = patch.port;
  if (patch.security !== undefined) set.security = patch.security;
  if (patch.username !== undefined) set.username = patch.username;
  if (patch.credentialId !== undefined) set.credentialId = patch.credentialId;
  if (patch.folder !== undefined) set.folder = patch.folder;
  const [row] = await db
    .update(mailAccount)
    .set(set)
    .where(and(eq(mailAccount.id, id), eq(mailAccount.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteAccount(db: Db, userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .delete(mailAccount)
    .where(and(eq(mailAccount.id, id), eq(mailAccount.userId, userId)))
    .returning();
  return Boolean(row);
}

export type MailListEntry = MailMessageSummary & {
  accountId: string;
  accountName: string;
};

export interface MailAgg {
  items: MailListEntry[];
  errors: Array<{ accountId: string; accountName: string; error: string }>;
}

/** 解析密码：credentialId 引用凭证库（SEC3）；无引用 = 空密码（如需匿名/前置认证失败）。 */
async function resolvePassword(db: Db, userId: string, account: MailAccount): Promise<string> {
  if (!account.credentialId) return "";
  const secret = await readSecret(db, userId, account.credentialId);
  if (secret === null) throw new MailError("凭证不存在或无权访问", 400);
  return secret;
}

async function assertReachable(account: MailAccount): Promise<void> {
  // SEC4：IMAP 目标与 HTTP 同基线（内网默认拒，allowPrivateOutbound 逃生阀）
  await assertSafeOutboundUrl(
    `https://${account.host}:${account.port}`,
    config.allowPrivateOutbound,
  );
}

export async function fetchMessages(
  db: Db,
  userId: string,
  opts: {
    accountIds?: string[];
    limit?: number;
    clientFactory?: MailClientFactory;
    /** 手动刷新：穿透 60s 列表缓存（FR-I3）。 */
    force?: boolean;
  } = {},
): Promise<MailAgg> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const all = await listAccounts(db, userId);
  const selected = opts.accountIds?.length
    ? all.filter((a) => opts.accountIds!.includes(a.id))
    : all;
  const factory = opts.clientFactory ?? createMailClient;

  const items: MailListEntry[] = [];
  const errors: MailAgg["errors"] = [];
  await Promise.all(
    selected.map(async (account) => {
      const cacheKey = `${account.id}:${account.folder}:${limit}`;
      const cached = listCache.get(cacheKey);
      if (!opts.force && cached && Date.now() - cached.at < LIST_TTL_MS) {
        items.push(...cached.items.map((i) => ({ ...i, accountId: account.id, accountName: account.name })));
        return;
      }
      try {
        await assertReachable(account);
        const password = await resolvePassword(db, userId, account);
        const client = factory(connOf(account, password));
        const list = await client.list(account.folder, limit);
        listCache.set(cacheKey, { at: Date.now(), items: list });
        items.push(...list.map((i) => ({ ...i, accountId: account.id, accountName: account.name })));
      } catch (e) {
        errors.push({
          accountId: account.id,
          accountName: account.name,
          error: e instanceof SsrfBlockedError ? `目标被 SSRF 基线拒绝：${e.message}` : (e instanceof Error ? e.message : String(e)),
        });
      }
    }),
  );
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { items, errors };
}

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…（已截断）` : s;
}

export async function fetchMessageBody(
  db: Db,
  userId: string,
  accountId: string,
  uid: number | string,
  clientFactory: MailClientFactory = createMailClient,
): Promise<MailMessageFull> {
  const account = await ownedAccount(db, userId, accountId);
  if (!account) throw new MailError("account not found", 404);
  await assertReachable(account);
  const password = await resolvePassword(db, userId, account);
  const client = clientFactory(connOf(account, password));
  const full = await client.body(account.folder, uid);
  if (!full) throw new MailError("message not found", 404);
  return { ...full, text: cap(full.text, TEXT_CAP), html: cap(full.html, HTML_CAP) };
}
