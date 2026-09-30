import { simpleParser } from "mailparser";

import type { MailClient, MailConnectionConfig, MailMessageFull, MailMessageSummary } from "./client.ts";

/**
 * Gmail 数据源（**D37：OAuth 授权流 + messages.list/get 只读**）。
 * - OAuth：用户提供 Google Cloud client_id/secret（环境变量 GMAIL_CLIENT_ID/SECRET），
 *   refresh_token 存凭证库（SEC3）；access_token 按需刷新、仅驻留内存；
 * - 只读（D3）：仅 users/me/profile、messages.list、messages.get；
 * - 基址可经环境变量指向 mock（单测），默认官方端点。
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const accountsBase = () => process.env.GMAIL_ACCOUNTS_BASE ?? "https://accounts.google.com";
const oauthBase = () => process.env.GMAIL_OAUTH_BASE ?? "https://oauth2.googleapis.com";
const apiBase = () => process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com";

export interface GmailTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export function buildGmailAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${accountsBase()}/o/oauth2/v2/auth?${q.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<GmailTokens> {
  const res = await fetch(`${oauthBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    redirect: "manual",
  });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`gmail oauth HTTP ${res.status}`);
  const parsed = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new Error("gmail oauth: no access_token");
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in ?? 3600,
  };
}

export function exchangeGmailCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<GmailTokens> {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

export function refreshGmailToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<GmailTokens> {
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
}

/** users/me/profile：绑定时取账号邮箱用于展示。 */
export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(`${apiBase()}/gmail/v1/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "manual",
  });
  if (res.status >= 400) throw new Error(`gmail api HTTP ${res.status}`);
  const parsed = (await res.json()) as { emailAddress?: string; messagesTotal?: number };
  return { emailAddress: parsed.emailAddress ?? "", messagesTotal: parsed.messagesTotal };
}

function headerOf(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function createGmailClient(conn: MailConnectionConfig): MailClient {
  const refreshToken = conn.refreshToken ?? "";
  const clientId = conn.clientId ?? "";
  const clientSecret = conn.clientSecret ?? "";
  let cached: { accessToken: string; expiresAt: number } | null = null;

  const token = async (): Promise<string> => {
    if (cached && Date.now() < cached.expiresAt) return cached.accessToken;
    const t = await refreshGmailToken(refreshToken, clientId, clientSecret);
    cached = { accessToken: t.accessToken, expiresAt: Date.now() + Math.max(30, t.expiresIn - 60) * 1000 };
    return t.accessToken;
  };

  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${apiBase()}${path}`, {
      headers: { Authorization: `Bearer ${await token()}` },
      redirect: "manual",
    });
    if (res.status >= 400) throw new Error(`gmail api HTTP ${res.status}`);
    return res.json();
  };

  return {
    async list(folder, limit) {
      const label = encodeURIComponent(folder || "INBOX");
      const listRes = (await get(
        `/gmail/v1/users/me/messages?labelIds=${label}&maxResults=${Math.min(limit, 50)}`,
      )) as { messages?: Array<{ id: string }> };
      const ids = (listRes.messages ?? []).map((m) => m.id);
      const out: MailMessageSummary[] = [];
      for (const id of ids) {
        const meta = (await get(
          `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata` +
            `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        )) as {
          id: string;
          internalDate?: string;
          labelIds?: string[];
          payload?: { headers?: Array<{ name?: string; value?: string }> };
        };
        const headers = meta.payload?.headers;
        const created = Number(meta.internalDate ?? 0);
        out.push({
          uid: meta.id,
          subject: headerOf(headers, "subject") || "(无主题)",
          from: headerOf(headers, "from"),
          date: created ? new Date(created).toISOString() : (headerOf(headers, "date") || ""),
          seen: (meta.labelIds ?? []).includes("SEEN"),
        });
      }
      out.sort((a, b) => (a.date < b.date ? 1 : -1));
      return out;
    },

    async body(_folder, uid) {
      const meta = (await get(
        `/gmail/v1/users/me/messages/${encodeURIComponent(String(uid))}?format=raw`,
      )) as { id: string; internalDate?: string; raw?: string; labelIds?: string[] };
      if (!meta?.raw) return null;
      const parsed = await simpleParser(Buffer.from(meta.raw, "base64url"));
      const created = Number(meta.internalDate ?? 0);
      return {
        uid: meta.id,
        subject: parsed.subject ?? "(无主题)",
        from: parsed.from?.text ?? "",
        date: parsed.date ? parsed.date.toISOString() : created ? new Date(created).toISOString() : "",
        seen: true, // 只读不回写 SEEN（D3）
        text: parsed.text ?? "",
        html: typeof parsed.html === "string" ? parsed.html : "",
      } satisfies MailMessageFull;
    },
  };
}
