import { describe, expect, it } from "vitest";

import { createImapClient, type ImapConnection, type ImapMessage } from "./imap.ts";

/**
 * TST-2（Q100g）：IMAP **适配层**逻辑单测（连接/UID 区间拉取/正文解析/登出映射）。
 * wire 协议归 imapflow（上游职责）；我们测自己的映射、排序、窗口与资源释放。
 */
function fakeConn(over: Partial<ImapConnection> = {}): ImapConnection & {
  calls: { fetched: string[]; loggedOut: number; released: number };
} {
  const calls = { fetched: [] as string[], loggedOut: 0, released: 0 };
  const msgs: ImapMessage[] = [
    {
      uid: 11,
      envelope: {
        subject: "旧邮件",
        from: [{ name: "甲", address: "a@x" }],
        date: "2026-09-01T00:00:00.000Z",
      },
      flags: new Set(["\\Seen"]),
    },
    {
      uid: 12,
      envelope: { subject: "新邮件", from: [{ address: "b@x" }], date: "2026-09-03T00:00:00.000Z" },
      flags: new Set<string>(),
    },
    { uid: 13, envelope: {}, flags: new Set() },
  ];
  return {
    calls,
    async connect() {},
    async getMailboxLock() {
      return {
        release() {
          calls.released += 1;
        },
      };
    },
    mailbox: { exists: 20 },
    async *fetch(range: string) {
      calls.fetched.push(range);
      for (const m of msgs) yield m;
    },
    async fetchOne() {
      return {
        uid: 7,
        source: [
          "From: 发件人 <c@x>",
          "To: t@x",
          "Subject: 普通主题",
          "Date: Thu, 03 Sep 2026 00:00:00 +0000",
          "",
          "正文 here",
        ].join("\r\n"),
      };
    },
    async logout() {
      calls.loggedOut += 1;
    },
    ...over,
  };
}

const conn = { host: "imap.x", port: 993, security: "ssl" as const, username: "u", password: "p" };

describe("IMAP 适配层（TST-2）", () => {
  it("list：UID 区间窗口正确、字段映射齐全、按时间新→旧排序", async () => {
    const fake = fakeConn();
    const out = await createImapClient(conn, () => fake).list("INBOX", 5);
    expect(fake.calls.fetched).toEqual(["16:20"]); // 20 封取最近 5 → 16:20
    expect(out.map((m) => m.uid)).toEqual([12, 11, 13]); // 无日期的排最后
    expect(out[0]).toMatchObject({ subject: "新邮件", from: "b@x", seen: false });
    expect(out[1]).toMatchObject({ subject: "旧邮件", from: "甲 <a@x>", seen: true });
    expect(out[2].subject).toBe("(无主题)");
    expect(fake.calls.released).toBe(1);
    expect(fake.calls.loggedOut).toBe(1);
  });

  it("list：空邮箱不发 fetch、仍正常登出", async () => {
    const fake = fakeConn({ mailbox: { exists: 0 } });
    const out = await createImapClient(conn, () => fake).list("INBOX", 5);
    expect(out).toEqual([]);
    expect(fake.calls.fetched).toEqual([]);
    expect(fake.calls.loggedOut).toBe(1);
  });

  it("list：fetch 中途抛错也会 release + logout，错误继续上抛", async () => {
    const fake = fakeConn({
      async *fetch() {
        throw new Error("boom");
      },
    });
    await expect(createImapClient(conn, () => fake).list("INBOX", 5)).rejects.toThrow("boom");
    expect(fake.calls.released).toBe(1);
    expect(fake.calls.loggedOut).toBe(1);
  });

  it("body：解析 RFC822 → 摘要字段（只读不回写 SEEN，视为已阅）", async () => {
    const fake = fakeConn();
    const out = await createImapClient(conn, () => fake).body("INBOX", 7);
    expect(out).toMatchObject({ uid: 7, subject: "普通主题", seen: true, text: "正文 here" });
    expect(out?.from).toContain("c@x"); // mailparser 的 from.text 会给名字加引号 —— 只断关键字段
    expect(fake.calls.released).toBe(1);
    expect(fake.calls.loggedOut).toBe(1);
  });

  it("body：找不到信 / 无 source → null（不抛）", async () => {
    const none = fakeConn({ async fetchOne() { return null; } });
    expect(await createImapClient(conn, () => none).body("INBOX", 9)).toBeNull();
    const noSource = fakeConn({ async fetchOne() { return { uid: 9, source: null }; } });
    expect(await createImapClient(conn, () => noSource).body("INBOX", 9)).toBeNull();
  });

  it("连接建立失败：错误带原因上抛（不吞）", async () => {
    const fake = fakeConn({
      async connect() {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await expect(createImapClient(conn, () => fake).list("INBOX", 5)).rejects.toThrow("ECONNREFUSED");
  });
});
