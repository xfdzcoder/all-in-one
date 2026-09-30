import { useState } from "react";
import { Badge, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";

import type { FeedItem, FeedSource } from "./api";
import { useDraft, useFeeds, useFeedSources, useFeedMutations } from "./data-hooks";
import { HtmlSandbox } from "./html-sandbox";
import { RelativeTime, WbAlert } from "./ui";

/**
 * RSS 组件（FR：多源订阅、摘要、未读标记归 Workspace、跳转原文）。
 * 已读态是 Workspace 数据 —— 任一组件标记，其它组件经 SSE 同步（FR-I6）。
 */
export type RssConfig = {
  limit?: number;
  filter?: "all" | "unread";
};

export function RssWidget({ limit = 10, filter = "all", refreshSec }: RssConfig & { refreshSec?: number }) {
  const { data, loading, error, refresh } = useFeeds(limit, refreshSec);
  const sources = useFeedSources();
  const { markRead, addSource, removeSource } = useFeedMutations();
  const [newUrl, setNewUrl] = useDraft();
  const [newTitle, setNewTitle] = useDraft();
  const [detail, setDetail] = useState<FeedItem | null>(null);
  const [unsub, setUnsub] = useState<FeedSource | null>(null);
  const [subOpen, setSubOpen] = useState(false);

  const items = (data?.items ?? []).filter((i: FeedItem) => (filter === "unread" ? !i.read : true));

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }}>
          信息流
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={refresh}>
          刷新
        </Button>
        <Button size="compact-xs" variant="subtle" onClick={() => setSubOpen((v) => !v)}>
          {subOpen ? "收起" : "+ 订阅源"}
        </Button>
        <Badge size="xs" variant="light">
          未读 {data?.unread ?? 0}
        </Badge>
      </Group>

      {subOpen && (
        <Group gap={4} wrap="nowrap">
          <TextInput
            size="compact-xs"
            placeholder="标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.currentTarget.value)}
            style={{ width: 70 }}
          />
          <TextInput
            size="compact-xs"
            placeholder="https://…/feed.xml"
            value={newUrl}
            onChange={(e) => setNewUrl(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            size="compact-xs"
            disabled={!newUrl.trim()}
            onClick={() => {
              addSource.mutate({ title: newTitle.trim() || "订阅", url: newUrl.trim() });
              setNewUrl("");
              setNewTitle("");
              setSubOpen(false);
            }}
          >
            订阅
          </Button>
        </Group>
      )}

      {loading && <Text size="xs" c="dimmed">加载中…</Text>}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {(data?.errors?.length ?? 0) > 0 && (
        <WbAlert tone="warning" size="sm">
          {data?.errors.length} 个源拉取失败
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
              onClick={() => {
                // FR-I4：点开详情（弹层）；跳转原文在详情内（S6）
                if (!it.read) markRead.mutate(it.itemKey);
                setDetail(it);
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

      {(sources.data ?? []).length > 0 && (
        <Group gap={4}>
          {(sources.data ?? []).map((s: FeedSource) => (
            <Badge key={s.id} size="xs" variant="outline" style={{ cursor: "pointer" }}
              onClick={() => setUnsub(s)}
              title="点击退订"
            >
              {s.title} ×
            </Badge>
          ))}
        </Group>
      )}
      {unsub && (
        <Modal opened onClose={() => setUnsub(null)} title="确认退订？" size="sm">
          <Text size="sm">
            确认退订「{unsub.title}」？（已读标记保留，可随时重新订阅）
          </Text>
          <Group gap="xs" mt="sm">
            <Button
              size="xs"
              color="red"
              onClick={() => {
                removeSource.mutate(unsub.id);
                setUnsub(null);
              }}
            >
              确认
            </Button>
            <Button size="xs" variant="default" onClick={() => setUnsub(null)}>
              取消
            </Button>
          </Group>
        </Modal>
      )}
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
