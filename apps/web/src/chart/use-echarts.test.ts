import { describe, expect, it } from "vitest";

import { useEcharts } from "./use-echarts.ts";

/** Q75/D55：钩子模块面（渲染行为由 Q76 图表组件的 verify 脚本实证）。 */

describe("useEcharts（D55 装载钩子）", () => {
  it("导出为函数（挂载/卸载/resize/option diff 语义见模块注释）", () => {
    expect(typeof useEcharts).toBe("function");
  });
});
