import { describe, expect, it } from "vitest";

import { compileChartOption, extractRows } from "./compile-option.ts";

/** Q76/D47：配置即 spec 的编译契约（含降级分支）。 */

const rows = [
  { t: "一月", a: 10, b: 20 },
  { t: "二月", a: 15, b: 25 },
  { t: "三月", a: null, b: 30 },
];

describe("extractRows（取数路径）", () => {
  it("点路径取数组；根即数组可用", () => {
    expect(extractRows({ data: { items: rows } }, "data.items")).toEqual({ rows });
    expect(extractRows(rows, undefined)).toEqual({ rows });
  });
  it("断路/非数组给「原因 + 怎么修」（D47 禁甩锅）", () => {
    const broken = extractRows({ data: 1 }, "data.items") as { error: string };
    expect(broken.error).toContain("走不到");
    expect(broken.error).toContain("检查路径");
    const notArr = extractRows({ data: { items: {} } }, "data.items") as { error: string };
    expect(notArr.error).toContain("不是数组");
    expect(notArr.error).toContain("取数路径");
  });
});

describe("compileChartOption（配置即 spec）", () => {
  it("line/bar：xField 分类 + yFields 系列 + unit 进轴名", () => {
    const r = compileChartOption({ chartType: "line", xField: "t", yFields: ["a", "b"], unit: "GB", smooth: true }, rows);
    if ("error" in r) throw new Error(r.error);
    const o = r.option as { xAxis: { data: string[] }; yAxis: { name: string }; series: Array<{ type: string; data: unknown[]; smooth?: boolean }> };
    expect(o.xAxis.data).toEqual(["一月", "二月", "三月"]);
    expect(o.yAxis.name).toBe("GB");
    expect(o.series).toHaveLength(2);
    expect(o.series[0]!.type).toBe("line");
    expect(o.series[0]!.data).toEqual([10, 15, null]); // 坏值留洞不丢行
    expect(o.series[0]!.smooth).toBe(true);
  });

  it("pie：xField=名、yFields[0]=值", () => {
    const r = compileChartOption({ chartType: "pie", xField: "t", yFields: ["a"] }, rows);
    if ("error" in r) throw new Error(r.error);
    const s = (r.option as { series: Array<{ data: Array<{ name: string; value: number }> }> }).series[0]!;
    expect(s.data).toEqual([
      { name: "一月", value: 10 },
      { name: "二月", value: 15 },
      { name: "三月", value: 0 },
    ]);
    expect(r.rows).toBe(3);
  });

  it("空数据/X 全缺 → 「原因 + 怎么修」；坏行跳过不整卡空白", () => {
    expect(compileChartOption({ chartType: "line", xField: "t", yFields: ["a"] }, [])).toHaveProperty("error");
    const onlyBad = compileChartOption({ chartType: "bar", xField: "t", yFields: ["a"] }, [{ no: 1 }]) as { error: string };
    expect(onlyBad.error).toContain("0 行可用");
    const mixed = compileChartOption({ chartType: "bar", xField: "t", yFields: ["a"] }, [...rows, { a: 1 }]) as { rows: number };
    expect(mixed.rows).toBe(3); // 缺 x 的行跳过
  });
});
