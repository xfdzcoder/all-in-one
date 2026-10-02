import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { echarts, type EChartsCoreOption } from "./echarts-setup.ts";
import { buildWbChartTheme, readThemeVars } from "./wb-theme.ts";

/**
 * 自写 ECharts 装载钩子（**Q75 / D55**）——不引 `echarts-for-react`：
 *
 * - **挂载/卸载**：`init` / `dispose`（组件卸载不泄漏 canvas 与实例）；
 * - **自适应**：`ResizeObserver` → `chart.resize()`（gridstack 卡片拖拽缩放跟随）；
 * - **option 更新**：`setOption(option, { lazyUpdate: true })` —— echarts 内部做 option diff
 *   （增量合并，不整树重置）；`null` = 清空（不渲染）；
 * - **主题跟随**（深浅双主题）：从容器读 `--wb-*` 令牌注册 theme；`data-theme` 切换时
 *   （MutationObserver）重初始化换主题。
 */
export function useEcharts(option: EChartsCoreOption | null): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const optionRef = useRef<EChartsCoreOption | null>(null);

  // 声明顺序 = effect 执行顺序（D55）：先同步 optionRef + 增量 setOption，再做初始化 ——
  // init 首帧即拿到当前 option；渲染期不碰 ref（react(refs)），exhaustive-deps 也不再催闭包依赖。
  useEffect(() => {
    optionRef.current = option;
    if (option && chartRef.current) chartRef.current.setOption(option, { lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const initChart = () => {
      chartRef.current?.dispose();
      const theme = buildWbChartTheme(readThemeVars(el));
      // registerTheme 按名注册；同名覆盖 = 随主题刷新
      echarts.registerTheme("wb-live", theme);
      const chart = echarts.init(el, "wb-live", { renderer: "canvas" });
      chartRef.current = chart;
      const opt = optionRef.current;
      if (opt) chart.setOption(opt, { lazyUpdate: true });
    };
    initChart();

    // 自适应：gridstack 拖拽/缩放卡片 → 图表跟随
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(el);
    // 深浅主题切换（tokens 换值）→ 重建实例换 theme
    const mo = new MutationObserver(() => initChart());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      ro.disconnect();
      mo.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return containerRef;
}
