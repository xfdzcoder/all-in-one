/**
 * 批H2（**Q76 / D47 + D57**）：**配置即 spec → ECharts option** 纯编译器。
 *
 * 不做预设指标 —— 用户自己声明「取数路径 + X 字段 + Y 字段 + 图表形态」，本模块只负责
 * 把数据行编译成 option。D47 降级口径：**不整卡空白** —— 坏行跳过、只有全坏/空数据才报错，
 * 且错误一律「原因 + 怎么修」（禁甩锅文案）。
 */

export interface ChartSpec {
  chartType: "line" | "bar" | "pie";
  /** 点路径（如 `data.items`）；空 = 根即数组。 */
  path?: string;
  xField: string;
  /** Y 系列字段名（饼图只用第一个）。 */
  yFields: string[];
  unit?: string;
  stack?: boolean;
  smooth?: boolean;
}

export type CompileResult = { option: Record<string, unknown>; rows: number } | { error: string };

/** 点路径取数组（`a.b.c`；空 = 根）。非数组/断路 → 「原因 + 怎么修」。 */
export function extractRows(data: unknown, path?: string): { rows: Record<string, unknown>[] } | { error: string } {
  let cur: unknown = data;
  if (path && path.trim()) {
    for (const seg of path.split(".")) {
      if (cur === null || typeof cur !== "object") {
        return { error: `取数路径「${path}」走不到「${seg}」—— 检查路径是否与接口返回的层级一致` };
      }
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  if (!Array.isArray(cur)) {
    return {
      error: `取数路径「${path || "（根）"}」不是数组 —— 图表按行取数，请把「取数路径」指向数组字段（如 data.items）`,
    };
  }
  return { rows: cur.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r)) };
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** 配置 + 数据 → option（纯函数；坏行跳过，全坏才报错）。 */
export function compileChartOption(spec: ChartSpec, data: unknown): CompileResult {
  const got = extractRows(data, spec.path);
  if ("error" in got) return got;
  const xs: string[] = [];
  const seriesData: Map<string, Array<number | null>> = new Map(spec.yFields.map((f) => [f, []]));
  let skipped = 0;
  for (const row of got.rows) {
    const x = row[spec.xField];
    if (x === undefined || x === null) {
      skipped += 1;
      continue;
    }
    xs.push(String(x));
    for (const f of spec.yFields) {
      const v = num(row[f]);
      seriesData.get(f)!.push(v ?? null);
      if (v === undefined) skipped += 1;
    }
  }
  if (xs.length === 0) {
    return {
      error: `0 行可用 —— 检查 X 字段「${spec.xField}」是否存在于数据行、或接口是否返回了空数组`,
    };
  }
  const unitSuffix = spec.unit ? `（${spec.unit}）` : "";

  if (spec.chartType === "pie") {
    const f = spec.yFields[0];
    if (!f) return { error: "饼图需要至少一个 Y 字段（取值列）—— 在「Y 系列字段」填 1 个字段名" };
    return {
      rows: xs.length,
      option: {
        tooltip: { trigger: "item" },
        series: [
          {
            type: "pie",
            radius: ["38%", "68%"],
            data: xs.map((name, i) => ({ name, value: seriesData.get(f)![i] ?? 0 })),
            label: { formatter: `{b}: {c}${spec.unit ?? ""}` },
          },
        ],
      },
    };
  }

  return {
    rows: xs.length,
    option: {
      tooltip: { trigger: "axis" },
      legend: spec.yFields.length > 1 ? {} : undefined,
      grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: xs, boundaryGap: spec.chartType === "bar" },
      yAxis: { type: "value", name: spec.unit },
      series: spec.yFields.map((f) => ({
        name: `${f}${unitSuffix}`,
        type: spec.chartType,
        data: seriesData.get(f),
        stack: spec.stack ? "total" : undefined,
        smooth: spec.chartType === "line" ? Boolean(spec.smooth) : undefined,
        showSymbol: false,
      })),
    },
  };
}
