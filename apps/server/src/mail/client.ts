/**
 * 邮件客户端抽象（Q7a）：只读聚合（D3 边界 —— 不发送/不删除/不回写 IMAP 状态）。
 * 服务层只依赖本接口，单元测试注入假客户端；生产实现 = imapflow 适配器（imap.ts）。
 */

export interface MailConnectionConfig {
  host: string;
  port: number;
  /** ssl | starttls | plain */
  security: string;
  username: string;
  /** 明文密码（来自凭证库解密，仅在连接期驻留内存；绝不入日志）。 */
  password: string;
}

export interface MailMessageSummary {
  uid: number;
  subject: string;
  from: string;
  /** ISO 时间串（解析失败时保留原串）。 */
  date: string;
  seen: boolean;
}

export interface MailMessageFull extends MailMessageSummary {
  text: string;
  html: string;
}

export interface MailClient {
  /** 最近 limit 封（新→旧）。 */
  list(folder: string, limit: number): Promise<MailMessageSummary[]>;
  body(folder: string, uid: number): Promise<MailMessageFull | null>;
}

export type MailClientFactory = (conn: MailConnectionConfig) => MailClient;
