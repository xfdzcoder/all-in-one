import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  normalizeImmich,
  normalizeMihomo,
  normalizeNavidrome,
  normalizePortainer,
  serviceOverviewConnector,
} from "./service.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

describe("服务概览适配器（Q39/D46）", () => {
  it("normalizeImmich：版本 + 照片/视频/占用", () => {
    const m = normalizeImmich({ version: { version: "1.95.2" }, stats: { photos: 12, videos: 3, usage: 2 ** 30 } });
    expect(m.probe.version).toBe("1.95.2");
    expect(m.stats).toEqual([
      { label: "照片", value: "12" },
      { label: "视频", value: "3" },
      { label: "占用", value: "1.0 GB" },
    ]);
  });

  it("normalizeNavidrome：subsonic-response 形状 + getStats 缺失容忍", () => {
    const m = normalizeNavidrome({
      ping: { "subsonic-response": { status: "ok", version: "0.53.3" } },
      stats: {},
    });
    expect(m.probe.version).toBe("0.53.3");
    expect(m.stats).toEqual([]);
  });

  it("normalizePortainer：端点数 + 运行中/总容器", () => {
    const m = normalizePortainer({
      status: { Version: "2.21.4" },
      endpoints: [{ Id: 1 }, { Id: 2 }],
      containers: [{ State: "running" }, { State: "exited" }, { State: "running" }],
    });
    expect(m.probe.version).toBe("2.21.4");
    expect(m.stats).toEqual([
      { label: "端点", value: "2" },
      { label: "容器", value: "2/3 运行中" },
    ]);
  });

  it("normalizeMihomo：版本 + 代理数 + 内存", () => {
    const m = normalizeMihomo({
      version: "v1.18.8",
      proxies: { proxies: { a: {}, b: {}, DIRECT: {} } },
      memory: { inuse: 2 ** 20 * 64 },
    });
    expect(m.probe.version).toBe("v1.18.8");
    expect(m.stats).toEqual([
      { label: "代理", value: "3" },
      { label: "内存", value: "64 MB" },
    ]);
  });
});

describe("service-overview 数据通道（sourceId → 连接派发）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-svc-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = {
      db,
      userId: "",
      readSecret: async () => null,
    } as FetchContext;
    mock = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      const url = req.url ?? "";
      if (url.startsWith("/version")) return res.end(JSON.stringify("v1.18.8"));
      if (url.startsWith("/proxies")) return res.end(JSON.stringify({ proxies: { a: {}, b: {} } }));
      if (url.startsWith("/memory")) return res.end(JSON.stringify({ inuse: 0 }));
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

  it("mihomo 连接派发到适配器；未选连接/连接不存在 显式报错", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo",
      configJson: JSON.stringify({ url: base }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const data = (await serviceOverviewConnector.fetch(
      { type: "service-overview", config: { sourceId: id } },
      ctx,
    )) as { probe: { ok: boolean; version?: string }; stats: Array<{ label: string; value: string }> };
    expect(data.probe.ok).toBe(true);
    expect(data.probe.version).toBe("v1.18.8");
    expect(data.stats.find((s) => s.label === "代理")?.value).toBe("2");

    await expect(
      serviceOverviewConnector.fetch({ type: "service-overview", config: {} }, ctx),
    ).rejects.toThrow("未选择数据连接");
    await expect(
      serviceOverviewConnector.fetch({ type: "service-overview", config: { sourceId: "nope" } }, ctx),
    ).rejects.toThrow("数据连接不存在");
  });
});
