import { IconRefresh } from "@tabler/icons-react";
import { Badge, Group, Stack, Text } from "@mantine/core";

import { useMihomoNodes } from "./data-hooks";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Mihomo 节点面板（FR-X3 只读深度，**D50**）：策略组 / 节点延迟 / 订阅源。
 * **D54**：策略组切换（FR-X3g）已移除 —— 本组件回归纯只读，无任何写操作。
 */
export function MihomoNodesWidget({ sourceId, refreshSec }: { sourceId?: string; refreshSec?: number }) {
  const { data, loading, error, refresh } = useMihomoNodes(sourceId, refreshSec);
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <ServiceIcon name="mihomo" size={16} />
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          节点面板{row?.name ? ` · ${row.name}` : ""}
        </Text>
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Mihomo 连接
          </Text>
        </div>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {data && (
        <Stack gap={6} style={{ flex: 1, overflow: "auto" }}>
          {data.groups.length > 0 && (
            <div className="wb-svc-list">
              <Text size="xs" fw={600} c="dimmed">
                策略组
              </Text>
              <Stack gap={2}>
                {data.groups.map((g) => (
                  <Group key={g.name} gap={6} wrap="nowrap">
                    <Text size="xs" truncate style={{ minWidth: 110 }}>
                      {g.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
                      → {g.now ?? "—"}
                    </Text>
                    <Badge size="xs" variant="light" color="blue">
                      {g.members}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </div>
          )}

          {data.nodes.length > 0 && (
            <div className="wb-svc-list">
              <Text size="xs" fw={600} c="dimmed">
                节点（{data.nodes.length}）
              </Text>
              <Stack gap={2}>
                {data.nodes.slice(0, 30).map((n) => (
                  <Group key={n.name} gap={6} wrap="nowrap">
                    <Text size="xs" truncate style={{ flex: 1 }}>
                      {n.name}
                    </Text>
                    {n.delayMs !== undefined ? (
                      <Badge size="xs" variant="light" color={n.delayMs < 300 ? "green" : "orange"}>
                        {n.delayMs} ms
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        未测速
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            </div>
          )}

          {data.providers.length > 0 && (
            <div className="wb-svc-list">
              <Text size="xs" fw={600} c="dimmed">
                订阅源
              </Text>
              <Stack gap={2}>
                {data.providers.map((p) => (
                  <Group key={p.name} gap={6} wrap="nowrap">
                    <Text size="xs" truncate style={{ flex: 1 }}>
                      {p.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {p.nodes} 节点
                      {p.updatedAt ? ` · 更新于 ${new Date(p.updatedAt).toLocaleDateString("zh-CN")}` : ""}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </div>
          )}

          {(data.notes ?? []).map((n, i) => (
            <Text key={i} size="xs" c="dimmed">
              · {n}
            </Text>
          ))}
        </Stack>
      )}
    </div>
  );
}
