/**
 * 主题桥（**Q75 / D55**）：`--wb-*` 设计令牌 → ECharts theme。
 *
 * 图表配色不写死十六进制 —— 深浅双主题都从 tokens.css 取色（D39：样式只引用 --wb-* 变量），
 * 用户覆盖 /custom.css 后图表跟随。纯函数形态（值映射）便于单测；读取侧只做 getComputedStyle。
 */

export interface WbChartTheme {
  /** 系列调色板（按 tokens 语义色序）。 */
  color: string[];
  textStyle: { color: string };
  axis: { line: { color: string }; label: { color: string }; splitLine: { color: string } };
  tooltip: { backgroundColor: string; borderColor: string; textStyle: { color: string } };
  legend: { textStyle: { color: string } };
  grid: { left: number; right: number; top: number; bottom: number; containLabel: boolean };
}

/** 参与主题桥的令牌名（与 tokens.css 对齐）。 */
export const THEME_VARS = [
  "--wb-color-accent",
  "--wb-color-success",
  "--wb-color-warning",
  "--wb-color-danger",
  "--wb-color-info",
  "--wb-color-text",
  "--wb-color-text-muted",
  "--wb-color-surface-raised",
  "--wb-color-border",
] as const;

/** 值映射：令牌值 → ECharts theme（纯函数；缺令牌回落合理缺省）。 */
export function buildWbChartTheme(vars: Partial<Record<(typeof THEME_VARS)[number], string>>): WbChartTheme {
  const v = (k: (typeof THEME_VARS)[number], fallback: string): string => {
    const got = vars[k]?.trim();
    return got ? got : fallback;
  };
  return {
    color: [
      v("--wb-color-accent", "#4f7dff"),
      v("--wb-color-info", "#2f9fc4"),
      v("--wb-color-success", "#2f9e63"),
      v("--wb-color-warning", "#d9822b"),
      v("--wb-color-danger", "#e35d5d"),
    ],
    textStyle: { color: v("--wb-color-text", "#e9ecef") },
    axis: {
      line: { color: v("--wb-color-border", "#2a3446") },
      label: { color: v("--wb-color-text-muted", "#9aa4b2") },
      splitLine: { color: v("--wb-color-border", "#2a3446") },
    },
    tooltip: {
      backgroundColor: v("--wb-color-surface-raised", "#1c2333"),
      borderColor: v("--wb-color-border", "#2a3446"),
      textStyle: { color: v("--wb-color-text", "#e9ecef") },
    },
    legend: { textStyle: { color: v("--wb-color-text-muted", "#9aa4b2") } },
    grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
  };
}

/** 从元素上读一组计算后的令牌值（唯一接触 DOM 的地方）。 */
export function readThemeVars(el: Element): Partial<Record<(typeof THEME_VARS)[number], string>> {
  const cs = getComputedStyle(el);
  const out: Partial<Record<(typeof THEME_VARS)[number], string>> = {};
  for (const name of THEME_VARS) {
    const val = cs.getPropertyValue(name).trim();
    if (val) out[name] = val;
  }
  return out;
}
