import { describe, expect, it } from "vitest";

import { buildWbChartTheme, THEME_VARS } from "./wb-theme.ts";

/** Q75/D55 主题桥：--wb-* 令牌 → ECharts theme（纯映射契约）。 */

describe("buildWbChartTheme（D55 主题桥）", () => {
  it("令牌五色进 palette（accent/info/success/warning/danger 顺序）", () => {
    const theme = buildWbChartTheme({
      "--wb-color-accent": "#111111",
      "--wb-color-info": "#222222",
      "--wb-color-success": "#333333",
      "--wb-color-warning": "#444444",
      "--wb-color-danger": "#555555",
    });
    expect(theme.color).toEqual(["#111111", "#222222", "#333333", "#444444", "#555555"]);
  });

  it("文本/轴/提示框颜色取对应令牌；缺令牌回落缺省（不炸）", () => {
    const theme = buildWbChartTheme({
      "--wb-color-text": "#eeeeee",
      "--wb-color-text-muted": "#999999",
      "--wb-color-surface-raised": "#222222",
      "--wb-color-border": "#333333",
    });
    expect(theme.textStyle.color).toBe("#eeeeee");
    expect(theme.axis.label.color).toBe("#999999");
    expect(theme.tooltip.backgroundColor).toBe("#222222");
    expect(theme.tooltip.borderColor).toBe("#333333");
    expect(buildWbChartTheme({}).textStyle.color.length).toBeGreaterThan(0);
  });

  it("THEME_VARS 与 tokens.css 的桥接面一致（改令牌名要同步这里）", () => {
    expect(THEME_VARS).toContain("--wb-color-accent");
    expect(THEME_VARS).toContain("--wb-color-border");
  });
});
