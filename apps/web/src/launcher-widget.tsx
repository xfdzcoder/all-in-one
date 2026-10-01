import { IconRefresh } from "@tabler/icons-react";
import { Badge, Group, Text } from "@mantine/core";

import { useAppLauncher } from "./data-hooks";
import { WbAlert, WbLoading, IconAction } from "./ui";
import { WidgetTitle } from "./widget-title";

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

export function LauncherWidget({ itemsJson, refreshSec }: LauncherConfig & { refreshSec?: number }) {
  const items = parseItems(itemsJson);
  const { data, loading, error, refresh } = useAppLauncher(items, refreshSec);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <WidgetTitle title="应用入口" truncate={false} />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          {data && (
            <Badge size="xs" variant="light" color={(data.up ?? 0) === data.total ? "green" : "orange"}>
              {data.up}/{data.total} 在线
            </Badge>
          )}
          <IconAction label="刷新" onClick={refresh}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      <Group gap="xs">
        {(data?.items ?? items).map((it: { name: string; url: string; alive?: boolean; icon?: string }) => (
          <a
            key={it.url}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <div className="wb-pill wb-launcher__pill">
              {/* ISS-20：可选图标（emoji 文本或图片 URL） */}
              {it.icon &&
                (/^https?:\/\//.test(it.icon) ? (
                  <img src={it.icon} alt="" width={16} height={16} className="wb-launcher__icon" />
                ) : (
                  <span aria-hidden>{it.icon}</span>
                ))}
              <Badge size="xs" circle color={it.alive ? "green" : "red"}>
                &nbsp;
              </Badge>
              <Text size="sm" c="white">
                {it.name}
              </Text>
            </div>
          </a>
        ))}
      </Group>
      {items.length === 0 && <Text size="xs" c="dimmed">配置 itemsJson 添加服务入口</Text>}
    </div>
  );
}
