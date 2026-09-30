import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { monitorConnector, normalizeGlances } from "./monitor.ts";
import type { FetchContext, WidgetDataQuery } from "./registry.ts";

let glances: Server;
let glancesUrl: string;
let partial: Server;
let partialUrl: string;
let seenAuth: string | null = null;

const ctx = {
  readSecret: async (id: string) => (id === "cred-1" ? "s3cret" : null),
} as unknown as FetchContext;

const query = (config: Record<string, unknown>): WidgetDataQuery => ({
  type: "monitor",
  config,
});

/** Glances API v4 形状（docs/api/restful.html 实测文档）。 */
const FIXTURES: Record<string, unknown> = {
  quicklook: {
    cpu: 14.3,
    mem: 39.9,
    load: 4.9,
    cpu_name: "Test CPU",
    cpu_phys_core: 10,
    cpu_log_core: 16,
  },
  load: { cpucore: 16, min1: 0.28, min5: 0.66, min15: 0.78 },
  mem: { total: 16417832960, used: 6555460504, percent: 39.9 },
  fs: [
    {
      device_name: "/dev/sda1",
      mnt_point: "/",
      percent: 52.3,
      size: 1003736440832,
      used: 497853181952,
      free: 454820753408,
    },
    { device_name: "zsfpool", mnt_point: "/zsfpool", percent: 0.3, size: 41811968, used: 131072 },
  ],
  uptime: JSON.stringify("3 days, 4:56:12"),
  version: JSON.stringify("7.2.2"),
};

beforeAll(async () => {
  glances = createServer((req, res) => {
    seenAuth = req.headers.authorization ?? null;
    res.setHeader("Content-Type", "application/json");
    const key = (req.url ?? "").split("/").pop() ?? "";
    if (key in FIXTURES) res.end(JSON.stringify(FIXTURES[key]));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => glances.listen(0, "127.0.0.1", r));
  glancesUrl = `http://127.0.0.1:${(glances.address() as { port: number }).port}`;

  // 只有 quicklook 可用（其余端点 500）—— best-effort 部分失败
  partial = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.url ?? "").endsWith("/quicklook")) res.end(JSON.stringify(FIXTURES.quicklook));
    else res.writeHead(500).end();
  });
  await new Promise<void>((r) => partial.listen(0, "127.0.0.1", r));
  partialUrl = `http://127.0.0.1:${(partial.address() as { port: number }).port}`;
});

afterAll(() => {
  glances.close();
  partial.close();
});

describe("monitor source adapter (D36: Glances 打通，只做连接与展示)", () => {
  it("normalizes Glances shapes (quicklook/load/fs/uptime/version)", async () => {
    const m = (await monitorConnector.fetch(query({ url: glancesUrl }), ctx)) as {
      probe: { ok: boolean; version?: string };
      cpu?: { percent: number };
      mem?: { percent: number };
      load?: { min1?: number; min15?: number };
      disks: Array<{ point: string; percent: number }>;
      uptime?: string;
      cpuName?: string;
    };
    expect(m.probe.ok).toBe(true);
    expect(m.probe.version).toBe("7.2.2");
    expect(m.cpu?.percent).toBe(14.3);
    expect(m.mem?.percent).toBe(39.9);
    expect(m.load?.min1).toBeCloseTo(0.28);
    expect(m.load?.min15).toBeCloseTo(0.78);
    expect(m.uptime).toBe("3 days, 4:56:12");
    expect(m.cpuName).toBe("Test CPU");
    expect(m.disks.map((d) => d.point)).toEqual(["/", "/zsfpool"]); // 按使用率降序
    expect(m.disks[0].percent).toBe(52.3);
  });

  it("injects basic and bearer auth from credential refs (SEC3)", async () => {
    await monitorConnector.fetch(
      query({ url: glancesUrl, authMode: "basic", username: "glances", apiToken: { credentialRef: "cred-1" } }),
      ctx,
    );
    expect(seenAuth).toBe(`Basic ${Buffer.from("glances:s3cret").toString("base64")}`);

    await monitorConnector.fetch(
      query({ url: glancesUrl, authMode: "bearer", apiToken: { credentialRef: "cred-1" } }),
      ctx,
    );
    expect(seenAuth).toBe("Bearer s3cret");
  });

  it("tolerates partial source failure (best-effort endpoints)", async () => {
    const m = (await monitorConnector.fetch(query({ url: partialUrl }), ctx)) as {
      probe: { ok: boolean };
      cpu?: { percent: number };
      disks: unknown[];
    };
    expect(m.probe.ok).toBe(true);
    expect(m.cpu?.percent).toBe(14.3);
    expect(m.disks).toEqual([]);
  });

  it("reports unreachable / non-Glances source as probe error (no throw)", async () => {
    const down = (await monitorConnector.fetch(
      query({ url: "http://127.0.0.1:1" }),
      ctx,
    )) as { probe: { ok: boolean; error?: string } };
    expect(down.probe.ok).toBe(false);
    expect(down.probe.error).toBeTruthy();

    const empty = (await monitorConnector.fetch(query({}), ctx)) as {
      probe: { ok: boolean; error?: string };
    };
    expect(empty.probe.ok).toBe(false);
    expect(empty.probe.error).toContain("未配置");

    // 全端点 200 但形状不符（非 Glances）→ 显式"形状不符"
    const weird = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ hello: "not glances" }));
    });
    await new Promise<void>((r) => weird.listen(0, "127.0.0.1", r));
    const weirdUrl = `http://127.0.0.1:${(weird.address() as { port: number }).port}`;
    const shaped = (await monitorConnector.fetch(query({ url: weirdUrl }), ctx)) as {
      probe: { ok: boolean; error?: string };
    };
    weird.close();
    expect(shaped.probe.ok).toBe(false);
    expect(shaped.probe.error).toContain("形状不符");
  });

  it("normalizeGlances tolerates missing/odd fields", () => {
    const m = normalizeGlances({ quicklook: { cpu: "NaN" }, fs: [{}, { mnt_point: "", percent: 1 }], uptime: 42 });
    expect(m.cpu).toBeUndefined();
    expect(m.disks).toEqual([]);
    expect(m.uptime).toBeUndefined();
  });
});
