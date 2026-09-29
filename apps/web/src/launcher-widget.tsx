import { Badge, Group, Stack, Text } from "@mantine/core";

import { useAppLauncher } from "./data-hooks";

/**
 * 应用入口 + 服务状态组件（FR：图标网格、HTTP/TCP 存活探测、点击跳转）。
 * 探测走服务端 app-launcher connector（内网服务探活，D22）；
 * 点击跳转由浏览器直接打开，不经服务端。
 */
export type LauncherConfig = {
  /** JSON 数组字符串：[{ name, url, probe? }] */
  itemsJson?: string;
};

type LaunchItem = { name: string; url: string; probe?: "http" | "tcp" };

function parseItems(json: string | undefined): LaunchItem[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function LauncherWidget({ itemsJson }: LauncherConfig) {
  const items = parseItems(itemsJson);
  const { data, loading, error } = useAppLauncher(items);

  return (
    <Stack gap={4} style={{ height: "100%", overflow: "auto", padding: 4 }}>
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }}>
          应用入口
        </Text>
        {data && (
          <Badge size="xs" variant="light" color={(data.up ?? 0) === data.total ? "green" : "orange"}>
            {data.up}/{data.total} 在线
          </Badge>
        )}
      </Group>
      {loading && <Text size="xs" c="dimmed">探测中…</Text>}
      {error && <Text size="xs" c="red">{error}</Text>}
      <Group gap="xs">
        {(data?.items ?? items).map((it: { name: string; url: string; alive?: boolean }) => (
          <a
            key={it.url}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <Group gap={6} wrap="nowrap" style={{ padding: "8px 12px", borderRadius: 8, background: "#222b3a" }}>
              <Badge size="xs" circle color={it.alive ? "green" : "red"}>
                &nbsp;
              </Badge>
              <Text size="sm" c="white">
                {it.name}
              </Text>
            </Group>
          </a>
        ))}
      </Group>
      {items.length === 0 && <Text size="xs" c="dimmed">配置 itemsJson 添加服务入口</Text>}
    </Stack>
  );
}
