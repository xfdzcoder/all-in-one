import { useState } from "react";
import { Badge, Button, Card, Group, JsonInput, Modal, Stack, Text } from "@mantine/core";

import { useServiceOverview } from "./data-hooks";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { WbAlert } from "./ui";

/**
 * 服务概览组件（Q39/D46）：选一个服务连接（Immich/Navidrome/Portainer/Mihomo）→
 * 探活徽标 + 版本 + 关键计数。只做连接与展示（D36）；深度组件属二期另立需求。
 */
export function ServiceOverviewWidget({ sourceId, refreshSec }: { sourceId?: string; refreshSec?: number }) {
  const { data, loading, error, refresh } = useServiceOverview(sourceId, refreshSec);
  const [detailOpen, setDetailOpen] = useState(false);
  // 连接 kind → 官方图标（画廊同款）
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);
  const kindIcon: Record<string, string> = {
    immich: "immich",
    navidrome: "navidrome",
    portainer: "portainer",
    mihomo: "mihomo",
    monitor: "glances",
    opencode: "opencode",
    http: "",
  };

  return (
    <div className="wb-widget">
      <Group gap={6}>
        {row && kindIcon[row.kind] ? <ServiceIcon name={kindIcon[row.kind]} size={16} /> : null}
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          {row?.name ?? "服务概览"}
        </Text>
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
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
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加服务连接
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "sources" } }))}
          >
            去添加连接
          </Button>
        </div>
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {data && !data.probe?.ok && (
        <WbAlert tone="warning" size="sm">
          无法读取服务：{data.probe?.error ?? "未知原因"}（D46：只做连接与展示）
        </WbAlert>
      )}
      {loading && (
        <Text size="xs" c="dimmed" className="wb-loading">
          加载中…
        </Text>
      )}
      {data?.probe?.ok && (
        <Stack gap={6} style={{ flex: 1, overflow: "auto" }}>
          {data.stats.map((s: { label: string; value: string }) => (
            <Card key={s.label} withBorder padding="xs" radius="sm">
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {s.label}
                </Text>
                <Text size="sm" fw={600}>
                  {s.value}
                </Text>
              </Group>
            </Card>
          ))}
          {data.stats.length === 0 && (
            <Text size="xs" c="dimmed">
              已连接（该服务未提供计数指标）
            </Text>
          )}
        </Stack>
      )}

      {detailOpen && data && (
        <Modal opened onClose={() => setDetailOpen(false)} title="详情 · 服务概览原始数据（FR-I4)" size="lg">
          <JsonInput value={JSON.stringify(data, null, 2)} autosize minRows={6} maxRows={16} readOnly />
        </Modal>
      )}
    </div>
  );
}
