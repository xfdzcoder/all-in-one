import { useState } from "react";
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";

import type { FeedItem } from "./api";
import { useFeeds, useFeedMutations } from "./data-hooks";
import { HtmlSandbox } from "./html-sandbox";
import { TagFilter } from "./tag-filter";
import { RelativeTime, WbAlert } from "./ui";

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
  const [detail, setDetail] = useState<FeedItem | null>(null);

  const items = (data?.items ?? []).filter((i: FeedItem) => (filter === "unread" ? !i.read : true));

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }}>
          信息流
        </Text>
        <TagFilter value={tagIds} targetLabel="订阅源条目" />
        <Button size="compact-xs" variant="subtle" onClick={refresh}>
          刷新
        </Button>
        <Badge size="xs" variant="light">
          未读 {data?.unread ?? 0}
        </Badge>
      </Group>

      {loading && <Text size="xs" c="dimmed" className="wb-loading">加载中…</Text>}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
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
                // FR-I4：点开详情（弹层）；跳转原文在详情内（S6）
                if (!it.read) markRead.mutate(it.itemKey);
                setDetail(it);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!it.read) markRead.mutate(it.itemKey);
                  setDetail(it);
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

      {detail && (
        <Modal opened onClose={() => setDetail(null)} title="文章详情" size="lg">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {detail.title}
            </Text>
            <Text size="xs" c="dimmed">
              {detail.sourceTitle} · <RelativeTime value={detail.date} />
            </Text>
            {/<[a-z/]/i.test(detail.summary) ? (
              <HtmlSandbox html={detail.summary} title={`rss-${detail.itemKey.slice(0, 8)}`} />
            ) : (
              <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                {detail.summary}
              </Text>
            )}
            {detail.link && (
              <Button
                size="xs"
                variant="light"
                component="a"
                href={detail.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                阅读原文
              </Button>
            )}
          </Stack>
        </Modal>
      )}
    </div>
  );
}
