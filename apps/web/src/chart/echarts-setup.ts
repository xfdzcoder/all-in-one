/**
 * 批H1（**Q75 / D55**）：Apache ECharts **按需注册**（`echarts/core` 树摇形态）。
 *
 * 只注册本工作台图表组件用得到的图表/组件/渲染器 —— 全量 `echarts` 会把不用的图表
 * 全打进包（维度⑪ 构建体积）。注册一次（模块级副作用），渲染器用 Canvas（体积/性能均衡）。
 */
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsCoreOption } from "echarts/core";
