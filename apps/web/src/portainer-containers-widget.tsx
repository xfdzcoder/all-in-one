import { IconRefresh, IconRotateClockwise } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, Code, Group, Modal, Stack, Text } from "@mantine/core";

import { usePortainerContainers, usePortainerLogs, usePortainerRestart } from "./data-hooks";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { ConfirmAction } from "./confirm";
import { WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Portainer 容器清单（FR-X3 只读深度，**D50**）：状态/端口/镜像，点行看日志尾部（只读）。
 * 无启停/重启/删除（写操作待拍板，FR-X3b）。
 */
export function PortainerContainersWidget({ sourceId, refreshSec }: { sourceId?: string; refreshSec?: number }) {
  const { data, loading, error, refresh } = usePortainerContainers(sourceId, refreshSec);
  const restart = usePortainerRestart(sourceId);
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null);
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);
  const logs = usePortainerLogs(logsFor ? sourceId : undefined, logsFor?.id);

  // Q56/D51：重启白名单（连接配置 restartAllow；空 = 不显示重启入口，服务端同样拒绝）
  const allowRaw = (row as { config?: Record<string, unknown> } | undefined)?.config?.restartAllow;
  const allowSet = new Set(
    (Array.isArray(allowRaw) ? allowRaw : typeof allowRaw === "string" ? allowRaw.split(/[,，]/) : [])
      .map((x) => String(x).trim())
      .filter(Boolean),
  );

  const containers = data?.containers ?? [];
  const abnormal = containers.filter((c) => c.abnormal);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <ServiceIcon name="portainer" size={16} />
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          容器清单{row?.name ? ` · ${row.name}` : ""}
        </Text>
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          {containers.length > 0 && (
            <Badge size="xs" variant="light" color={abnormal.length > 0 ? "red" : "green"}>
              {containers.length - abnormal.length}/{containers.length} 正常
            </Badge>
          )}
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Portainer 连接
          </Text>
        </div>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {restart.error && <WbAlert tone="error" size="sm">重启失败：{restart.error}</WbAlert>}

      <Stack gap={4} style={{ flex: 1, overflow: "auto" }}>
        {containers.map((c) => (
          <button
            key={c.id}
            type="button"
            className="wb-admin-row"
            title="点击查看日志尾部（只读）"
            onClick={() => setLogsFor({ id: c.id, name: c.name })}
            style={{ textAlign: "left", cursor: "pointer" }}
          >
            <Group gap={6} wrap="nowrap">
              <Text size="xs" fw={c.abnormal ? 700 : 500} truncate style={{ minWidth: 100 }}>
                {c.name}
              </Text>
              <Badge
                size="compact-xs"
                variant="light"
                color={c.state === "running" ? "green" : c.abnormal ? "red" : "gray"}
              >
                {c.state}
              </Badge>
              <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
                {c.status}
                {c.ports ? ` · ${c.ports}` : ""}
              </Text>
              {allowSet.has(c.name) && (
                <ConfirmAction
                  label="重启"
                  title={`重启容器「${c.name}」？`}
                  message={`将重启容器「${c.name}」——容器内服务会短暂中断。确认执行？`}
                  onConfirm={() => restart.send(c.id)}
                  icon={<IconRotateClockwise size={14} />}
                />
              )}
            </Group>
          </button>
        ))}
        {containers.length === 0 && !loading && !error && sourceId && (
          <Text size="xs" c="dimmed">
            暂无容器
          </Text>
        )}
      </Stack>

      {logsFor && (
        <Modal opened onClose={() => setLogsFor(null)} title={`日志尾部 · ${logsFor.name}（只读）`} size="lg">
          {logs.loading && <WbLoading rows={2} />}
          {logs.error && <WbAlert tone="error" size="sm">{logs.error}</WbAlert>}
          {logs.logs && (
            <Code block style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {logs.logs}
            </Code>
          )}
          <Text size="xs" c="dimmed" mt="sm">
            只读展示 —— 容器启停属写操作（FR-X3b 待拍板）
          </Text>
        </Modal>
      )}
    </div>
  );
}
