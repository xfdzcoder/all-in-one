import { Alert, Badge, Button, Card, Group, Stack, Text } from "@mantine/core";

import { useOpencodeData } from "./data-hooks";

/**
 * OpenCode 组件（FR-E4/06 §1）：会话列表 / 状态 / 耗时 + API 版本探测。
 * 数据走宿主数据通道（opencode connector，D32）；experimental API 形状变更时
 * 组件显式提示（probe.error），不空白。
 * 配置（configSchema）：地址 url、访问令牌 apiToken（凭证库引用，SEC3）、条数 limit。
 */

function formatDuration(ms: number): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`;
}

function formatTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function OpencodeWidget(config: { url?: string; limit?: number } & Record<string, unknown>) {
  const { data, loading, error, refresh } = useOpencodeData(config);
  const url = config.url;

  return (
    <Stack gap={6} style={{ height: "100%", overflow: "hidden" }}>
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }}>
          OpenCode 会话
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
        <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
          刷新
        </Button>
      </Group>

      {!url && (
        <Text size="xs" c="dimmed">
          配置 opencode server 地址后显示会话
        </Text>
      )}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
      {data && !data.probe?.ok && (
        <Alert color="yellow">
          <Text size="xs">
            无法读取 opencode API：{data.probe?.error ?? "未知原因"}（实验性接口，版本不兼容时会在此提示）
          </Text>
        </Alert>
      )}
      {loading && (
        <Text size="xs" c="dimmed">
          探测中…
        </Text>
      )}

      <Stack gap={4} style={{ flex: 1, overflow: "auto" }}>
        {data?.probe?.ok && (data.sessions ?? []).length === 0 && (
          <Text size="xs" c="dimmed">
            暂无会话
          </Text>
        )}
        {(data?.sessions ?? []).map((s) => (
          <Card key={s.id} withBorder padding={6} radius={6}>
            <Group gap={6} justify="space-between" wrap="nowrap">
              <Text size="xs" fw={500} lineClamp={1} style={{ flex: 1 }}>
                {s.title}
              </Text>
              <Badge size="xs" variant="outline">
                {formatDuration(s.durationMs)}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              更新于 {formatTime(s.updatedAt)}
            </Text>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
