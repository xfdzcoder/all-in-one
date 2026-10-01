import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { mihomoNodesConnector, normalizeMihomoNodes } from "./mihomo-nodes.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q53 契约测试（Mihomo 节点面板，FR-X3 只读深度 D50）。 */

describe("normalizeMihomoNodes（D50）", () => {
  it("策略组（all+now）与节点分离 + 延迟尾点 + 订阅源", () => {
    const out = normalizeMihomoNodes(
      {
        proxies: {
          GLOBAL: { now: "DIRECT", all: ["DIRECT", "A"], history: [] },
          "♻️ 自动选择": { now: "香港", all: ["香港", "日本"], history: [] },
          香港: { type: "Shadowsocks", alive: true, history: [{ delay: 88 }] },
          日本: { type: "Shadowsocks", alive: false, history: [] },
        },
      },
      { providers: { airport: { proxies: [{}, {}], updatedAt: "2026-09-30T12:00:00Z" } } },
    );
    expect(out.groups.map((g) => [g.name, g.now, g.members])).toEqual([
      ["GLOBAL", "DIRECT", 2],
      ["♻️ 自动选择", "香港", 2],
    ]);
    expect(out.nodes).toEqual([
      { name: "香港", type: "Shadowsocks", alive: true, delayMs: 88 },
      { name: "日本", type: "Shadowsocks", alive: false, delayMs: undefined },
    ]);
    expect(out.providers).toEqual([{ name: "airport", nodes: 2, updatedAt: "2026-09-30T12:00:00Z" }]);
  });
});

describe("mihomo-nodes 数据通道（sourceId 派发）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-mn-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if (url.startsWith("/proxies"))
        return res.end(
          JSON.stringify({
            proxies: {
              GLOBAL: { now: "DIRECT", all: ["DIRECT"], history: [] },
              DIRECT: { type: "Direct", history: [] },
            },
          }),
        );
      if (url.startsWith("/providers/proxies")) return res.end(JSON.stringify({ providers: {} }));
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

  it("派发 Mihomo 连接；非 Mihomo 连接显式拒绝", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-nodes",
      configJson: JSON.stringify({ url: base, secret: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const data = (await mihomoNodesConnector.fetch({ type: "mihomo-nodes", config: { sourceId: id } }, ctx)) as {
      groups: Array<{ name: string }>;
      nodes: Array<{ name: string }>;
    };
    expect(data.groups.map((g) => g.name)).toEqual(["GLOBAL"]);
    expect(data.nodes.map((n) => n.name)).toEqual(["DIRECT"]);

    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "portainer",
      name: "mock-pt-for-mn",
      configJson: JSON.stringify({ url: base, apiToken: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      mihomoNodesConnector.fetch({ type: "mihomo-nodes", config: { sourceId: wrongKind } }, ctx),
    ).rejects.toThrow("节点面板需要 Mihomo 连接");
  });
});
