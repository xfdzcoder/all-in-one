import { demuxDockerLog } from "./portainer-containers.ts";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  normalizePortainerContainers,
  portainerContainersConnector,
  portainerLogsConnector,
} from "./portainer-containers.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q52 契约测试（Portainer 容器清单，FR-X3 只读深度 D50）。 */

describe("normalizePortainerContainers（D50）", () => {
  it("状态/端口/镜像 + 异常判定（Exited 非 0）", () => {
    const items = normalizePortainerContainers([
      { Id: "c1", Names: ["/good"], State: "running", Status: "Up 2 days", Image: "nginx", Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: "tcp" }] },
      { Id: "c2", Names: ["/bad"], State: "exited", Status: "Exited (143) 3 days ago" },
      { Id: "c3", Names: ["/rest"], State: "exited", Status: "Exited (0) 5 days ago" },
    ]);
    expect(items.map((i) => [i.name, i.abnormal])).toEqual([
      ["good", false],
      ["bad", true],
      ["rest", false], // 正常退出不算异常
    ]);
    expect(items[0].ports).toBe("8080→80/tcp");
    expect(items[0].image).toBe("nginx");
  });
});

describe("portainer 容器清单/日志数据通道", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-pc-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/api/endpoints/1/docker/containers/") && url.includes("/logs")) {
        res.setHeader("Content-Type", "application/vnd.docker.raw-stream");
        return res.end(Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, 5]), Buffer.from("hello"), Buffer.from([1, 0, 0, 0, 0, 0, 0, 3]), Buffer.from("bye")]));
      }
      if (url.startsWith("/api/endpoints/1/docker/containers/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify([{ Id: "c1", Names: ["/web"], State: "running", Status: "Up 1 day", Ports: [] }]));
      }
      if (url.startsWith("/api/endpoints")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify([{ Id: 1, Name: "local" }]));
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    mock?.close();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("清单派发 + 日志剥帧（只读）", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "portainer",
      name: "mock-pt",
      configJson: JSON.stringify({ url: base, apiToken: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const data = (await portainerContainersConnector.fetch(
      { type: "portainer-containers", config: { sourceId: id } },
      ctx,
    )) as { containers: Array<{ name: string }> };
    expect(data.containers.map((c) => c.name)).toEqual(["web"]);

    const logs = (await portainerLogsConnector.fetch(
      { type: "portainer-logs", config: { sourceId: id, containerId: "c1" } },
      ctx,
    )) as { logs: string };
    expect(logs.logs).toContain("hello");
    expect(logs.logs).toContain("bye");
  });
});

describe("demuxDockerLog（SRV-20：按帧格式真解析）", () => {
  const frame = (streamType: number, payload: Uint8Array): Uint8Array => {
    const out = new Uint8Array(8 + payload.length);
    out[0] = streamType;
    out[4] = (payload.length >>> 24) & 0xff;
    out[5] = (payload.length >>> 16) & 0xff;
    out[6] = (payload.length >>> 8) & 0xff;
    out[7] = payload.length & 0xff;
    out.set(payload, 8);
    return out;
  };
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

  it("多帧拼接为纯正文，无帧头残留", () => {
    const bytes = new Uint8Array([
      ...frame(1, enc("hello\n")),
      ...frame(2, enc("warn\n")),
      ...frame(1, enc("world\n")),
    ]);
    expect(demuxDockerLog(bytes)).toBe("hello\nwarn\nworld\n");
  });

  it("长度低位字节是可打印字符（≥0x20）也不残留乱码（旧正则翻车点）", () => {
    const payload = enc("x".repeat(32)); // len=32 → 低字节 0x20（空格）
    const bytes = frame(1, payload);
    expect(demuxDockerLog(bytes)).toBe("x".repeat(32));
  });

  it("TTY raw 流（无帧头）整段原文回落", () => {
    expect(demuxDockerLog(enc("plain tty line\nnext\n"))).toBe("plain tty line\nnext\n");
  });

  it("ANSI 颜色码剥离、\n/\t 保留", () => {
    const bytes = frame(1, enc("\u001b[31mred\u001b[0m\tend\n"));
    expect(demuxDockerLog(bytes)).toBe("red\tend\n");
  });

  it("尾部残缺帧 → 保守回落原文", () => {
    const good = frame(1, enc("ok\n"));
    const truncated = new Uint8Array([...good, 1, 0, 0, 0]); // 帧头不全
    expect(demuxDockerLog(truncated)).toContain("ok\n");
  });
});
