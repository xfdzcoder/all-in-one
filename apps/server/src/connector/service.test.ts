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

describe("服务概览适配器（Q39/D46 接入 · Q44/D48 结构化重做）", () => {
  it("normalizeImmich：v3 版本形状 + 指标/按用户清单/降级说明（真机实测形状）", () => {
    const m = normalizeImmich({
      version: { major: 3, minor: 2, patch: 2 },
      stats: {
        photos: 16309,
        videos: 140,
        usage: 95158019655,
        usagePhotos: 61859586795,
        usageVideos: 33298432860,
        usageByUser: [{ userId: "u1", userName: "xfdzcoder", photos: 16309, videos: 140, usage: 95158019655 }],
      },
      errors: [{ what: "统计", err: new Error("service API HTTP 403") }],
    });
    expect(m.probe.version).toBe("3.2.2");
    expect(m.metrics.find((x) => x.emphasis)?.label).toBe("照片");
    expect(m.metrics.map((x) => x.label)).toEqual(["照片", "视频", "存储占用", "用户"]);
    expect(m.lists?.[0].items[0]).toMatchObject({ title: "xfdzcoder" });
    // 诚实降级：403 → 权限 + 怎么修（禁止"服务未提供"甩锅）
    expect(m.notes?.[0]).toContain("API Key 权限不足");
    expect(m.notes?.[0]).toContain("API Keys");
  });

  it("normalizeNavidrome：scanStatus + getArtists 聚合（getStats 不存在的等价指标）+ 清单", () => {
    const m = normalizeNavidrome({
      ping: { "subsonic-response": { status: "ok", version: "1.16.1", serverVersion: "0.58.0" } },
      scanStatus: { "subsonic-response": { scanStatus: { scanning: false, count: 1376, lastScan: "2026-09-25T03:04:48Z" } } },
      artists: {
        "subsonic-response": {
          artists: { index: [{ name: "A", artist: [{ id: "1", name: "甲", albumCount: 100 }, { id: "2", name: "乙", albumCount: 169 }] }] },
        },
      },
      newest: { "subsonic-response": { albumList2: { album: [{ name: "CHIN UP!", artist: "陈奕迅" }] } } },
      nowPlaying: { "subsonic-response": { nowPlaying: { entry: [{ title: "曲A", username: "xfdzcoder" }] } } },
    });
    expect(m.metrics.map((x) => [x.label, x.value])).toEqual([
      ["曲目", "1,376"],
      ["专辑", "269"],
      ["艺术家", "2"],
      ["上次扫描", expect.any(String)],
    ]);
    expect(m.metrics[0].emphasis).toBe(true);
    expect(m.lists?.find((l) => l.title === "最近添加")?.items[0].title).toBe("CHIN UP!");
    expect(m.lists?.find((l) => l.title === "正在播放")?.items[0]).toMatchObject({ title: "曲A" });
    expect(m.statuses?.[0].text).toBe("库就绪");
  });

  it("normalizePortainer：异常容器清单优先（用户头号问题「容器都活着吗」）", () => {
    const m = normalizePortainer({
      status: { Version: "2.27.6" },
      endpoints: [{ Id: 3 }],
      containers: [
        { Names: ["/immich_server"], State: "running", Status: "Up 2 days" },
        { Names: ["/homepage"], State: "exited", Status: "Exited (1) 2 days ago" },
        { Names: ["/kopia"], State: "exited", Status: "Exited (0) 5 days ago" },
      ],
      info: { Containers: 3, Images: 32, NVolumes: 5, NCPU: 12, MemTotal: 15 * 2 ** 30 },
    });
    expect(m.metrics.find((x) => x.emphasis)?.value).toBe("1/3");
    expect(m.statuses?.[0]).toEqual({ tone: "error", text: "1 个容器异常" });
    expect(m.lists?.[0].title).toBe("异常容器");
    expect(m.lists?.[0].items).toEqual([{ title: "homepage", detail: "Exited (1) 2 days ago", tone: "error" }]);
    expect(m.metrics.find((x) => x.label === "宿主")?.value).toBe("12 核 · 15.0 GB");
  });

  it("normalizePortainer：全健康给绿态不留空（08 §3）", () => {
    const m = normalizePortainer({
      status: { Version: "2.27.6" },
      endpoints: [{ Id: 3 }],
      containers: [{ Names: ["/a"], State: "running", Status: "Up 1 day" }],
      info: {},
    });
    expect(m.statuses?.[0]).toEqual({ tone: "ok", text: "全部容器正常" });
    expect(m.lists?.[0].title).toBe("容器状态");
  });

  it("normalizeMihomo：策略组选择 + 连接/累计流量 + sample 采样点（速率由前端差分）", () => {
    const m = normalizeMihomo({
      version: { meta: true, version: "v1.19.31" },
      proxies: {
        proxies: {
          GLOBAL: { now: "DIRECT", all: ["DIRECT"], history: [] },
          "♻️ 自动选择": { now: "香港WAP-优化", all: ["a", "b"], history: [{ delay: 120 }] },
          DIRECT: { type: "Direct", history: [] },
        },
      },
      connections: { downloadTotal: 31.5 * 2 ** 30, uploadTotal: 12.9 * 2 ** 30, connections: [{}, {}] },
      rules: { providers: { custom: { ruleCount: 11 } } },
      proxyProviders: { providers: { airport: {} } },
      errors: [{ what: "内存", err: new Error("This operation was aborted") }],
    });
    expect(m.metrics.find((x) => x.emphasis)).toMatchObject({ label: "出口选择", value: "DIRECT" });
    expect(m.metrics.find((x) => x.label === "活动连接")?.value).toBe("2");
    expect(m.sample?.series.connections).toBe(2);
    expect(m.sample?.series.downTotal).toBeCloseTo(31.5 * 2 ** 30);
    expect(m.lists?.find((l) => l.title === "策略组选择")?.items).toContainEqual({
      title: "♻️ 自动选择",
      detail: "→ 香港WAP-优化",
      tone: "info",
    });
    expect(m.lists?.find((l) => l.title === "节点延迟")?.items[0]).toMatchObject({ detail: "120 ms", tone: "ok" });
    expect(m.notes?.[0]).toContain("内存获取失败");
  });

  it("所有适配器输出过契约校验（validateServiceOverview）", async () => {
    const { validateServiceOverview } = await import("@all-in-one/widget-sdk");
    for (const o of [
      normalizeImmich({ version: { major: 3, minor: 2, patch: 2 }, stats: {} }),
      normalizeNavidrome({ ping: { "subsonic-response": { version: "1" } } }),
      normalizePortainer({ status: {}, endpoints: [] }),
      normalizeMihomo({ version: "v1", errors: [{ what: "内存", err: new Error("x") }] }),
    ]) {
      expect(validateServiceOverview(o)).toEqual([]);
    }
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
    )) as { probe: { ok: boolean; version?: string }; metrics: Array<{ label: string; value: string }> };
    expect(data.probe.ok).toBe(true);
    expect(data.probe.version).toBe("v1.18.8");
    expect(data.metrics.find((s) => s.label === "节点/策略")?.value).toBe("2");

    await expect(
      serviceOverviewConnector.fetch({ type: "service-overview", config: {} }, ctx),
    ).rejects.toThrow("未选择数据连接");
    await expect(
      serviceOverviewConnector.fetch({ type: "service-overview", config: { sourceId: "nope" } }, ctx),
    ).rejects.toThrow("数据连接不存在");
  });
});
