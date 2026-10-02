import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type {
  MailClient,
  MailConnectionConfig,
  MailMessageFull,
  MailMessageSummary,
} from "./client.ts";

/**
 * imapflow 适配器（Q7a，06 §1"IMAP 多账号聚合"）：只读（D3）——仅 SELECT + FETCH。
 * 连接逐次建立/登出；密码来自凭证库解密值，仅在连接期驻留内存，绝不入日志。
 * TLS：security=ssl → 隐式 TLS（993）；starttls/plain → 明文起步、服务器支持则自动
 * 升级 STARTTLS（imapflow 机会性升级；"plain" 不强制，风险由账号配置者承担）。
 */

const TIMEOUT_MS = 15_000;

function senderOf(list: Array<{ name?: string; address?: string }> | undefined): string {
  const first = list?.[0];
  if (!first) return "";
  return first.name ? `${first.name} <${first.address ?? ""}>` : (first.address ?? "");
}

function isoOf(d: Date | string | false | undefined): string {
  if (d instanceof Date) return d.toISOString();
  return typeof d === "string" ? d : "";
}

/** IMAP 连接的窄接口（TST-2/Q100g）：**可注入假连接**做适配层单测 ——
 *  连接/UID 区间拉取/正文解析/登出这套映射逻辑归我们，wire 协议归 imapflow。 */
export type ImapMessage = {
  uid: number | string;
  envelope?: {
    subject?: string;
    from?: Array<{ name?: string; address?: string }>;
    date?: Date | string | false;
  };
  flags?: Set<string>;
  source?: string | Buffer | null;
};

export type ImapConnection = {
  connect(): Promise<void>;
  getMailboxLock(folder: string): Promise<{ release(): void }>;
  mailbox?: { exists?: number };
  fetch(range: string, opts: Record<string, unknown>): AsyncIterable<ImapMessage>;
  fetchOne(
    uid: number | string,
    opts: Record<string, unknown>,
    opts2?: Record<string, unknown>,
  ): Promise<ImapMessage | null>;
  logout(): Promise<void>;
};

export function createImapClient(
  conn: MailConnectionConfig,
  imapFactory: () => ImapConnection = () =>
    new ImapFlow({
      host: conn.host,
      port: conn.port,
      secure: conn.security === "ssl",
      auth: { user: conn.username, pass: conn.password },
      logger: false,
      socketTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
    }) as unknown as ImapConnection,
): MailClient {
  const connect = async (): Promise<ImapConnection> => {
    const client = imapFactory();
    await client.connect();
    return client;
  };

  return {
    async list(folder, limit) {
      const client = await connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const total = typeof client.mailbox === "object" ? (client.mailbox.exists ?? 0) : 0;
          if (total === 0) return [];
          const start = Math.max(1, total - limit + 1);
          const out: MailMessageSummary[] = [];
          for await (const msg of client.fetch(`${start}:${total}`, {
            uid: true,
            envelope: true,
            flags: true,
          })) {
            out.push({
              uid: msg.uid,
              subject: msg.envelope?.subject ?? "(无主题)",
              from: senderOf(msg.envelope?.from),
              date: isoOf(msg.envelope?.date),
              seen: msg.flags?.has("\\Seen") ?? false,
            });
          }
          out.sort((a, b) => (a.date < b.date ? 1 : -1));
          return out;
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    },

    async body(folder, uid) {
      const client = await connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const found = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
          if (!found || typeof found !== "object" || !found.source) return null;
          const parsed = await simpleParser(found.source);
          return {
            uid: found.uid ?? uid,
            subject: parsed.subject ?? "(无主题)",
            from: parsed.from?.text ?? "",
            date: parsed.date ? parsed.date.toISOString() : "",
            seen: true, // 只读不回写 SEEN；拉取正文视为已阅
            text: parsed.text ?? "",
            html: typeof parsed.html === "string" ? parsed.html : "",
          } satisfies MailMessageFull;
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}
