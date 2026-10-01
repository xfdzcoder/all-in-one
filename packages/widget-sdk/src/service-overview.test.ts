import { describe, expect, it } from "vitest";

import { emptyOverview, validateServiceOverview } from "./service-overview.ts";
import type { ServiceOverview } from "./service-overview.ts";

/** Q44a 契约测试（D48 结构化服务概览 —— D7 契约先行）。 */
describe("validateServiceOverview (D48)", () => {
  const valid: ServiceOverview = {
    probe: { ok: true, source: "immich", version: "3.2.2" },
    metrics: [
      { label: "照片", value: "16,309", emphasis: true, hint: "占用 58.5 GB" },
      { label: "视频", value: "140" },
    ],
    statuses: [{ tone: "ok", text: "已连接" }],
    lists: [{ title: "按用户", items: [{ title: "xfdzcoder", detail: "16309 照片 · 95.2 GB" }] }],
    sample: { at: "2026-10-01T00:00:00Z", series: { upBps: 1200, downBps: 88000 } },
    notes: ["内存获取失败（/memory 经反代超时）—— 该项暂缺"],
  };

  it("accepts a full structured overview", () => {
    expect(validateServiceOverview(valid)).toEqual([]);
  });

  it("accepts minimal overview (metrics empty, probe failed)", () => {
    expect(validateServiceOverview({ probe: { ok: false, source: "mihomo", error: "timeout" }, metrics: [] })).toEqual([]);
  });

  it("rejects missing probe / wrong probe fields", () => {
    expect(validateServiceOverview({ metrics: [] })).toContain("probe 缺失");
    expect(validateServiceOverview({ probe: { ok: "yes", source: "" }, metrics: [] })).toEqual(
      expect.arrayContaining(["probe.ok 必须是 boolean", "probe.source 必须是非空字符串"]),
    );
  });

  it("rejects >1 emphasis metrics and bad metric shape", () => {
    const errs = validateServiceOverview({
      probe: { ok: true, source: "x" },
      metrics: [
        { label: "A", value: "1", emphasis: true },
        { label: "B", value: "2", emphasis: true },
        { label: "", value: 3 },
      ],
    });
    expect(errs).toContain("emphasis 主指标至多 1 个");
    expect(errs).toContain("metrics[2].label 必须是非空字符串");
    expect(errs).toContain("metrics[2].value 必须是字符串");
  });

  it("rejects bad sample series values", () => {
    const errs = validateServiceOverview({
      probe: { ok: true, source: "mihomo" },
      metrics: [],
      sample: { at: "", series: { upBps: "fast", downBps: Number.NaN } },
    });
    expect(errs).toContain("sample.at 必须是非空字符串");
    expect(errs).toContain("sample.series.upBps 必须是有限数值");
    expect(errs).toContain("sample.series.downBps 必须是有限数值");
  });

  it("rejects non-string notes entries", () => {
    const errs = validateServiceOverview({ probe: { ok: true, source: "x" }, metrics: [], notes: ["ok", ""] });
    expect(errs).toContain("notes[1] 必须是非空字符串");
  });

  it("emptyOverview keeps honest degradation (note = cause)", () => {
    const e = emptyOverview("portainer", "连接超时（8s）");
    expect(validateServiceOverview(e)).toEqual([]);
    expect(e.probe.ok).toBe(false);
    expect(e.notes).toEqual(["连接超时（8s）"]);
  });
});
