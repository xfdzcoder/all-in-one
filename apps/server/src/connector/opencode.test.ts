import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { opencodeConnector } from "./opencode.ts";
import type { FetchContext, WidgetDataQuery } from "./registry.ts";

let okServer: Server;
let okPort: number;
let weirdServer: Server;
let weirdPort: number;
let downServer: Server;
let downPort: number;
let seenAuth: string | null = null;

const ctx = {
  readSecret: async (id: string) => (id === "cred-1" ? "sk-opc-token" : null),
} as unknown as FetchContext;

const query = (config: Record<string, unknown>): WidgetDataQuery => ({
  type: "opencode",
  config,
});

beforeAll(async () => {
  // mock server 均在回环地址 —— 需放行内网出站（SSRF 基线另有专门用例临时关闭）
  process.env.ALLOW_PRIVATE_OUTBOUND = "1";

  // 正常 opencode server 形状（experimental API 当前形状：/app + /session）
  okServer = createServer((req, res) => {
    seenAuth = req.headers.authorization ?? null;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/app") {
      res.end(JSON.stringify({ name: "opencode", version: "0.1.2" }));
    } else if (req.url === "/session") {
      res.end(
        JSON.stringify([
          { id: "s2", title: "修 bug", time: { created: 1000, updated: 4000 } },
          { id: "s1", title: "写文档", time: { created: 500, updated: 1500 } },
          { id: "s3", time: { created: 10, updated: 20 } }, // 无标题
        ]),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => okServer.listen(0, "127.0.0.1", r));
  okPort = (okServer.address() as { port: number }).port;

  // 形状不符（HTML 页面 / 对象而非数组）
  weirdServer = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ unexpected: true }));
  });
  await new Promise<void>((r) => weirdServer.listen(0, "127.0.0.1", r));
  weirdPort = (weirdServer.address() as { port: number }).port;

  // 不可达：占端口后关闭
  downServer = createServer();
  await new Promise<void>((r) => downServer.listen(0, "127.0.0.1", r));
  downPort = (downServer.address() as { port: number }).port;
  await new Promise<void>((r) => downServer.close(() => r()));
});

afterAll(() => {
  okServer.close();
  weirdServer.close();
  delete process.env.ALLOW_PRIVATE_OUTBOUND;
});

describe("opencode connector (FR-E4, D32)", () => {
  it("probes version and normalizes sessions (newest first, duration derived)", async () => {
    const data = (await opencodeConnector.fetch(
      query({ url: `http://127.0.0.1:${okPort}`, limit: 10 }),
      ctx,
    )) as { probe: { ok: boolean; version?: string }; sessions: Array<Record<string, unknown>> };
    expect(data.probe.ok).toBe(true);
    expect(data.probe.version).toBe("0.1.2");
    expect(data.sessions.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
    expect(data.sessions[0].durationMs).toBe(3000);
    expect(data.sessions[2].title).toBe("(无标题会话)");
  });

  it("injects bearer token from credential refs (SEC3)", async () => {
    await opencodeConnector.fetch(
      query({ url: `http://127.0.0.1:${okPort}`, apiToken: { credentialRef: "cred-1" } }),
      ctx,
    );
    expect(seenAuth).toBe("Bearer sk-opc-token");
  });

  it("surfaces experimental API shape mismatch as probe error", async () => {
    const data = (await opencodeConnector.fetch(
      query({ url: `http://127.0.0.1:${weirdPort}` }),
      ctx,
    )) as { probe: { ok: boolean; error?: string }; sessions: unknown[] };
    expect(data.probe.ok).toBe(false);
    expect(data.probe.error).toContain("形状不符");
    expect(data.sessions).toEqual([]);
  });

  it("surfaces unreachable server as probe error (no throw)", async () => {
    const data = (await opencodeConnector.fetch(
      query({ url: `http://127.0.0.1:${downPort}` }),
      ctx,
    )) as { probe: { ok: boolean; error?: string } };
    expect(data.probe.ok).toBe(false);
    expect(String(data.probe.error)).toMatch(/失败|不可达|unreachable|fetch|aborted|ECONN|ENOTFOUND|timeout|refused|非 Glances/i); // TST-6：弱断言加固（存在 → 含真实原因）
  });

  it("reports missing config and unreachable targets without throwing", async () => {
    const empty = (await opencodeConnector.fetch(query({}), ctx)) as {
      probe: { ok: boolean; error?: string };
    };
    expect(empty.probe.ok).toBe(false);
    expect(empty.probe.error).toContain("未配置");

    // 内网目标属服务聚合核心场景（D32 allowPrivate 通道）：不可达时报 probe 错误而非 SSRF 拒绝
    delete process.env.ALLOW_PRIVATE_OUTBOUND;
    const down = (await opencodeConnector.fetch(
      query({ url: `http://127.0.0.1:${downPort}` }),
      ctx,
    )) as { probe: { ok: boolean; error?: string } };
    expect(down.probe.ok).toBe(false);
    expect(String(down.probe.error)).toMatch(/失败|不可达|unreachable|fetch|aborted|ECONN|ENOTFOUND|timeout|refused|非 Glances/i); // TST-6：弱断言加固（存在 → 含真实原因）
  });
});
