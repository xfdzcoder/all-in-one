import { IconRefresh, IconInfoCircle } from "./icons";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Badge, Button, Card, Group, JsonInput, Modal, Progress, Stack, Text } from "@mantine/core";

import { useMonitorData, useResolvedSourceConfig, useSourceMeta } from "./data-hooks";
import { WidgetTitle } from "./widget-title";
import { copyText } from "./clipboard";
import { SourceHint, WbAlert, IconAction } from "./ui";

/**
 * 服务器监控组件（FR：服务器监控；**D36 打通第三方服务，只做连接与展示**）。
 * v1 数据源 = Glances（`glances -w` REST API）；指标卡（CPU/内存/负载/运行时长）+
 * 磁盘进度条 + 详情弹层（FR-I4）。认证口令经凭证库（SEC3）。
 */

function fmtBytes(n?: number): string {
  if (typeof n !== "number") return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function MetricCard({
  label,
  value,
  hint,
  fill,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Q74 批G：液面高度 0–100（无数据不传 = 不画液面，D47 降级）。 */
  fill?: number;
}) {
  return (
    <Card
      withBorder
      padding="xs"
      radius="sm"
      className={fill === undefined ? undefined : "wb-metric-fill"}
      style={
        fill === undefined
          ? { flex: 1, minWidth: 90 }
          : ({ flex: 1, minWidth: 90, "--wb-fill": Math.max(0, Math.min(100, fill)) } as CSSProperties)
      }
    >
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={600}>
        {value}
      </Text>
      {/* Q37：hint 行恒占位 —— 三卡内容结构一致（等高） */}
      <Text size="xs" c="dimmed">
        {hint || "\u00a0"}
      </Text>
    </Card>
  );
}

/** ISS-18：运行时长本地化（"5 days, 1:02:03" → "5 天 1 小时 2 分"；原值由调用处留 title）。 */
function formatUptimeZh(raw: string): string {
  const m = raw.match(/(?:(\d+)\s*days?,?\s*)?(\d+):(\d+):(\d+)/i);
  if (!m) return raw;
  const [, d, h, min] = m;
  const parts: string[] = [];
  if (d && Number(d) > 0) parts.push(`${Number(d)} 天`);
  parts.push(`${Number(h)} 小时`, `${Number(min)} 分`);
  return parts.join(" ");
}

export function MonitorWidget(config: { url?: string; refreshSec?: number } & Record<string, unknown>) {
  // D42：数据连接优先（sourceId），内联配置回落
  const resolved = useResolvedSourceConfig("monitor", config);
  const { data, loading, error, refresh } = useMonitorData(resolved);
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);
  // Q36：按解析后配置判定空态（sourceId 命中连接 / 旧内联均算已配置）
  const url = (resolved as { url?: string }).url;
  // Q85（项 11）：标题显示**实际的数据源名称**（未绑定连接时回落组件名）
  const sourceId = typeof config.sourceId === "string" ? config.sourceId : "";
  // WEB-12：连接元信息一次订阅（kind=monitor；Q86/D59 标题区跳转到该数据源站点）
  const { sourceName, homeUrl } = useSourceMeta("monitor", sourceId);

  return (
    <div className="wb-widget">
      <WidgetTitle title={sourceName ?? "服务器监控"} href={homeUrl}
        actions={
          <>
            {data?.probe?.ok && (
              <Badge size="xs" color="green" variant="light">
                {data.probe.version ? `v${data.probe.version}` : "已连接"}
              </Badge>
            )}
            {data && !data.probe?.ok && (
              <Badge size="xs" color="red" variant="light">
                探测失败
              </Badge>
            )}
            {data && (
              <IconAction label="详情" onClick={() => setDetailOpen(true)}><IconInfoCircle size={14} /></IconAction>
            )}
            <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
          </>
        }
      />

      {!url && (
        // Q36：无监控源 → 引导去数据源管理配置（组件表单只做选择）
        <SourceHint text="暂无监控源 —— 请到「数据源管理 · 数据连接」添加" actionLabel="去添加监控源" />
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {data && !data.probe?.ok && (
        <WbAlert tone="warning" size="sm">
          无法读取监控源：{data.probe?.error ?? "未知原因"}（D36：只做连接与展示）
        </WbAlert>
      )}
      {loading && (
        <Text size="xs" c="dimmed">
          采集中…
        </Text>
      )}

      {data?.probe?.ok && (
        <Stack gap={6} className="wb-scroll-area">
          <Group gap="xs" wrap="nowrap" align="stretch">
            <MetricCard
              label="CPU"
              value={data.cpu ? `${data.cpu.percent.toFixed(1)}%` : "—"}
              fill={data.cpu?.percent}
            />
            <MetricCard
              label="内存"
              value={data.mem ? `${data.mem.percent.toFixed(1)}%` : "—"}
              hint={data.mem?.totalBytes ? `${fmtBytes(data.mem.usedBytes)} / ${fmtBytes(data.mem.totalBytes)}` : undefined}
              fill={data.mem?.percent}
            />
            <MetricCard
              label="负载"
              fill={
                data.load?.min1 !== undefined && data.cores
                  ? (data.load.min1 / data.cores) * 100 // Q74：load1/cores 归一（1.0/核 = 满载）
                  : undefined
              }
              value={data.load?.min1 !== undefined ? data.load.min1.toFixed(2) : "—"}
              hint={
                data.load?.min5 !== undefined
                  ? `${data.load.min5.toFixed(2)} / ${data.load.min15?.toFixed(2) ?? "—"}`
                  : data.cores
                    ? `${data.cores} 核`
                    : undefined
              }
            />
          </Group>
          {data.uptime && (
            <Text size="xs" c="dimmed">
              运行时长：{formatUptimeZh(data.uptime)}
              {data.cpuName ? ` · ${data.cpuName}` : ""}
            </Text>
          )}
          <Stack gap={4}>
            {data.disks.map((d) => (
              <div key={d.point}>
                <Group gap={6} justify="space-between">
                  <Text size="xs" lineClamp={1} className="wb-flex-1">
                    {d.point}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {fmtBytes(d.usedBytes)} / {fmtBytes(d.totalBytes)}
                  </Text>
                </Group>
                <Progress
                  size="md"
                  value={d.percent}
                  color={d.percent >= 90 ? "red" : d.percent >= 75 ? "orange" : "blue"}
                />
              </div>
            ))}
            {data.disks.length === 0 && (
              <Text size="xs" c="dimmed">
                无磁盘数据
              </Text>
            )}
          </Stack>
        </Stack>
      )}

      {detailOpen && data && (
        <Modal opened onClose={() => setDetailOpen(false)} title="详情 · 监控原始指标（FR-I4）" size="lg">
          <Group justify="flex-end" mb="xs">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                // ISS-25：2s 复位 + 失败显式提示。
                // Q80：改用 copyText —— 直接调 navigator.clipboard 在 HTTP（非安全上下文）
                // 下会同步抛（clipboard 是 undefined），`.catch()` 接不住。
                void copyText(JSON.stringify(data, null, 2)).then((ok) => {
                  setCopied(ok);
                  // WEB-28：复位定时器随组件卸载清理，避免卸载后 setState
                  if (ok) {
                    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
                    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
                  }
                  return ok; // promise(always-return)：链式语义明确
                });
              }}
            >
              {copied ? "已复制" : "复制 JSON"}
            </Button>
          </Group>
          <JsonInput
            className="wb-code"
            value={JSON.stringify(data, null, 2)}
            readOnly
            autosize
            minRows={6}
            maxRows={20}
            size="xs"
          />
        </Modal>
      )}
    </div>
  );
}
