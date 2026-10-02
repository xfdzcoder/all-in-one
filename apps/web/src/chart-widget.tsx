import { useMemo, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";

import { appendStreamRows, compileChartOption, type ChartSpec } from "./chart/compile-option";
import type { EChartsCoreOption } from "./chart/echarts-setup";
import { useEcharts } from "./chart/use-echarts";
import { useCustomApiData, useResolvedSourceConfig } from "./data-hooks";
import { useWsStream } from "./ws-stream";
import { WidgetTitle } from "./widget-title";
import { IconAction, SourceHint, WbAlert, WbLoading } from "./ui";

/**
 * 自定义图表 v1（**批H2 / Q76，D47 + D57**）：**配置即 spec**（非预设指标）。
 *
 * 数据面复用 `httpConnector`（custom-api 数据通道，**零服务端改动**）：URL/认证走组件配置 +
 * 数据连接（D42），`path` 客户端提取行数据；spec 编译见 `chart/compile-option.ts`（纯函数、单测覆盖）。
 */
export function ChartWidget(props: Record<string, unknown>) {
  // D42 + D65：认证来源（sourceId 提供 authHeader/apiToken）——**卡片已填 > 来源**
  // （不同才需填，填了只覆盖本卡）；相对 url 按来源站点地址拼接
  const resolved = useResolvedSourceConfig("http", props, ["authHeader", "apiToken"], {
    inlineWins: true,
    resolveRelativeUrl: true,
  });
  const { data, loading, error, refresh } = useCustomApiData(resolved);

  // Q78/D56：WS 流模式 —— wsSourceId 命中即实时流（滚动窗口 120 点），否则走 HTTP 快照
  const wsSourceId = typeof props.wsSourceId === "string" && props.wsSourceId ? props.wsSourceId : undefined;
  const [streamRows, setStreamRows] = useState<Array<Record<string, unknown>>>([]);
  useWsStream(wsSourceId, (payload) => setStreamRows((prev) => appendStreamRows(prev, payload)));

  // 字段先取原始值（简单依赖），spec 与 compiled 链式 memo（值不变不重编）
  const chartType = props.chartType === "bar" || props.chartType === "pie" ? props.chartType : "line";
  const path = typeof props.path === "string" ? props.path : undefined;
  const xField = typeof props.xField === "string" && props.xField ? props.xField : "x";
  const yFieldsRaw = String(props.yFields ?? "");
  const unit = typeof props.unit === "string" && props.unit ? props.unit : undefined;
  const stack = props.stack === true;
  const smooth = props.smooth === true;

  const spec = useMemo<ChartSpec>(
    () => ({
      chartType,
      path,
      xField,
      yFields: yFieldsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      unit,
      stack,
      smooth,
    }),
    [chartType, path, xField, yFieldsRaw, unit, stack, smooth],
  );
  const compiled = useMemo(
    () =>
      wsSourceId
        ? streamRows.length === 0
          ? null
          : compileChartOption(spec, streamRows)
        : data === undefined || data === null
          ? null
          : compileChartOption(spec, data),
    [wsSourceId, streamRows, data, spec],
  );
  const option = compiled && "option" in compiled ? (compiled.option as EChartsCoreOption) : null;
  const chartRef = useEcharts(option);

  return (
    <div className="wb-widget">
      <WidgetTitle
        title="图表"
        actions={<IconAction label="刷新" onClick={refresh}><IconRefresh size={14} /></IconAction>}
      />
      {wsSourceId ? (
        <span className="wb-sr-only">{`实时 · ${streamRows.length} 点`}</span>
      ) : (
        compiled && "rows" in compiled && <span className="wb-sr-only">{`${compiled.rows} 点`}</span>
      )}
      {!resolved.url && (
        <SourceHint text="未配置接口地址 —— 填「接口地址」（可填相对路径如 /api/stats，基于「认证来源」的地址；认证头/令牌可选认证来源）" />
      )}
      {loading && <WbLoading />}
      {/* D47：错误/降级一律「原因 + 怎么修」，不整卡空白不留白 */}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {compiled && "error" in compiled && <WbAlert tone="warning" size="sm">{compiled.error}</WbAlert>}
      {/* 容器**常驻挂载**（hidden 语义隐藏）：条件渲染会让 useEcharts 的 init effect
          首跑时拿不到 ref → 画布永不初始化；显示/隐藏由 ResizeObserver 触发 resize 兜住 */}
      <div
        className="wb-chart"
        ref={chartRef}
        role="img"
        aria-label="图表"
        hidden={loading || Boolean(error) || Boolean(compiled && "error" in compiled)}
      />
    </div>
  );
}
