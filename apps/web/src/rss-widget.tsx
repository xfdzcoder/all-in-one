import { IconRefresh } from "@tabler/icons-react";
import { Badge, Group, Text } from "@mantine/core";

import type { FeedItem } from "./api";
import { useFeedMutations, useFeeds } from "./data-hooks";
import { WidgetTitle } from "./widget-title";
import { WbAlert, WbLoading, IconAction } from "./ui";

/**
 * RSS 组件（FR：多源订阅、摘要、未读标记归 Workspace、跳转原文）。
 * 已读态是 Workspace 数据 —— 任一组件标记，其它组件经 SSE 同步（FR-I6）。
 * 订阅源管理与打标签在「数据管理」（FR-D2/D40）；本组件按标签选源（FR-D3）。
 */
export type RssConfig = {
  limit?: number;
  filter?: "all" | "unread";
  /** FR-D3：按标签选源（OR 语义；空/缺省 = 全部）。 */
  tagIds?: string[];
};

export function RssWidget({
  limit = 10,
  filter = "all",
  tagIds,
  refreshSec,
}: RssConfig & { refreshSec?: number }) {
  const { data, loading, error, refresh } = useFeeds(limit, refreshSec, filter, tagIds);
  const { markRead } = useFeedMutations();

  const items = (data?.items ?? []).filter((i: FeedItem) => (filter === "unread" ? !i.read : true));

  return (
    <div className="wb-widget">
      <Group gap={6}>
        {/* Q85（项 12）：标题统一为「RSS」；Q86/D59：信息流无站点，不渲染成链接 */}
        <WidgetTitle title="RSS" />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={refresh}><IconRefresh size={14} /></IconAction>
          <Badge size="xs" variant="light">
            未读 {data?.unread ?? 0}
          </Badge>
        </Group>
      </Group>

      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {(data?.staleSources?.length ?? 0) > 0 && (
        <WbAlert tone="info" size="sm">
          {(data?.staleSources ?? []).length} 个源暂不可用，显示上次拉取的缓存条目
        </WbAlert>
      )}
      {(data?.errors?.length ?? 0) > 0 && (
        // ISS-16：逐源明细（源名 + 原因），排障不再只看到数字
        <WbAlert tone="warning" size="sm">
          {data?.errors.length} 个源拉取失败
          {(data?.errors ?? []).map((e: { title: string; error: string }) => (
            <div key={e.title} className="wb-text--xs">
              {e.title}：{e.error}
            </div>
          ))}
        </WbAlert>
      )}

      {items.map((it: FeedItem) => (
        <Group key={it.itemKey} gap="xs" wrap="nowrap" align="flex-start">
          <Badge size="xs" circle color={it.read ? "gray" : "blue"} style={{ marginTop: 4 }}>
            &nbsp;
          </Badge>
          <div className="wb-grow">
            <Text
              size="xs"
              fw={it.read ? 400 : 700}
              className="wb-clickable"
              role="button"
              tabIndex={0}
              onClick={() => {
                // Q29c/二.2：点击 = 新标签打开原文 + 标已读（无详情弹层）
                if (!it.read) markRead.mutate(it.itemKey);
                if (it.link) window.open(it.link, "_blank", "noopener");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!it.read) markRead.mutate(it.itemKey);
                  if (it.link) window.open(it.link, "_blank", "noopener");
                }
              }}
            >
              {it.title}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {it.sourceTitle} · {it.summary}
            </Text>
          </div>
        </Group>
      ))}
      {items.length === 0 && !loading && <Text size="xs" c="dimmed">暂无条目</Text>}

    </div>
  );
}
