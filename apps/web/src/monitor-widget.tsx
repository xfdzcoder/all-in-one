import { useState } from "react";
import { Alert, Badge, Button, Card, Group, JsonInput, Modal, Progress, Stack, Text } from "@mantine/core";

import { useMonitorData } from "./data-hooks";

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

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder padding="xs" radius="sm" style={{ flex: 1, minWidth: 90 }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={600}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

export function MonitorWidget(config: { url?: string; refreshSec?: number } & Record<string, unknown>) {
  const { data, loading, error, refresh } = useMonitorData(config);
  const [detailOpen, setDetailOpen] = useState(false);
  const url = config.url;

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }}>
          服务器监控
        </Text>
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
          <Button size="compact-xs" variant="subtle" onClick={() => setDetailOpen(true)}>
            详情
          </Button>
        )}
        <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
          刷新
        </Button>
      </Group>

      {!url && (
        <Text size="xs" c="dimmed">
          配置监控源地址（如 Glances）后显示指标
        </Text>
      )}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
      {data && !data.probe?.ok && (
        <Alert color="yellow">
          <Text size="xs">无法读取监控源：{data.probe?.error ?? "未知原因"}（D36：只做连接与展示）</Text>
        </Alert>
      )}
      {loading && (
        <Text size="xs" c="dimmed">
          采集中…
        </Text>
      )}

      {data?.probe?.ok && (
        <Stack gap={6} style={{ flex: 1, overflow: "auto" }}>
          <Group gap="xs" wrap="nowrap">
            <MetricCard label="CPU" value={data.cpu ? `${data.cpu.percent.toFixed(1)}%` : "—"} />
            <MetricCard
              label="内存"
              value={data.mem ? `${data.mem.percent.toFixed(1)}%` : "—"}
              hint={data.mem?.totalBytes ? `${fmtBytes(data.mem.usedBytes)} / ${fmtBytes(data.mem.totalBytes)}` : undefined}
            />
            <MetricCard
              label="负载"
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
              运行时长：{data.uptime}
              {data.cpuName ? ` · ${data.cpuName}` : ""}
            </Text>
          )}
          <Stack gap={4}>
            {data.disks.map((d) => (
              <div key={d.point}>
                <Group gap={6} justify="space-between">
                  <Text size="xs" lineClamp={1} style={{ flex: 1 }}>
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
          <JsonInput value={JSON.stringify(data, null, 2)} readOnly autosize minRows={6} maxRows={20} size="xs" />
        </Modal>
      )}
    </div>
  );
}
