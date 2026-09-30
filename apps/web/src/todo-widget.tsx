import { useState } from "react";
import { Button, Checkbox, Group, List, Modal, Stack, Text, TextInput } from "@mantine/core";

import type { TodoItem } from "./api";
import { ConfirmAction } from "./confirm";
import { useDraft, useTodoMutations, useTodos } from "./data-hooks";
import { TagFilter } from "./tag-filter";
import { RelativeTime, WbAlert } from "./ui";

/** Todo 组件配置（configSchema 元数据见 widget-manifests.ts）。
 *  gridstack 直接把布局 JSON 的 props 展开传入，即扁平 config 形态。 */
export type TodoConfig = {
  list?: string;
  filter?: "open" | "all";
  /** FR-D3：按标签选数据（OR 语义；空/缺省 = 全部）。 */
  tagIds?: string[];
};

/** 清单显示名映射（P1-4）：默认键的人话名；未收录的键原样显示（用户自定义清单）。 */
const LIST_NAMES: Record<string, string> = {
  inbox: "收件箱",
  work: "工作",
  home: "家庭",
  personal: "个人",
};
const listLabel = (key: string) => LIST_NAMES[key] ?? key;

/**
 * Todo Widget（FR：Workspace 级数据、勾选完成/新增）。
 * 数据来自 Workspace（D21），多个组件/页面共享同一份 —— J4 验证点。
 * 注：M2 内置组件直接消费工作台 REST + SSE（业务数据通道）；
 * 第三方数据类组件（custom-api）走服务端 connector 数据通道（M2-⑤）。
 */
export function TodoWidget({ list = "inbox", filter = "open", tagIds, refreshSec }: TodoConfig & { refreshSec?: number }) {
  const { data, loading, error, refresh } = useTodos(list, refreshSec, tagIds);
  const { create, toggle, remove } = useTodoMutations();
  const [draft, setDraft] = useDraft();
  const [detail, setDetail] = useState<TodoItem | null>(null);

  const items = (data ?? []).filter((t) => (filter === "open" ? !t.done : true));

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <Text size="sm" fw={600} style={{ flex: 1 }}>
          Todo · {listLabel(list)}
        </Text>
        <TagFilter value={tagIds} targetLabel="任务" />
        <Button size="compact-xs" variant="subtle" onClick={refresh}>
          刷新
        </Button>
      </Group>
      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder="新任务…"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              create.mutate(draft.trim());
              setDraft("");
            }
          }}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          disabled={!draft.trim()}
          onClick={() => {
            create.mutate(draft.trim());
            setDraft("");
          }}
        >
          添加
        </Button>
      </Group>
      {loading && <Text size="xs" c="dimmed">加载中…</Text>}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      <List listStyleType="none" style={{ flex: 1, overflow: "auto" }}>
        {items.map((t) => (
          <List.Item key={t.id}>
            <Group gap="xs" wrap="nowrap">
              <Checkbox
                checked={t.done}
                onChange={(e) => toggle.mutate({ id: t.id, done: e.currentTarget.checked })}
                aria-label={`toggle ${t.title}`}
              />
              <Text
                size="sm"
                style={{ flex: 1, textDecoration: t.done ? "line-through" : undefined, cursor: "pointer" }}
                onClick={() => setDetail(t)}
              >
                {t.title}
              </Text>
              <ConfirmAction
                label="×"
                size="compact-xs"
                variant="subtle"
                title="删除任务？"
                message={`确认删除任务「${t.title}」？（不可恢复）`}
                onConfirm={() => remove.mutate(t.id)}
              />
            </Group>
          </List.Item>
        ))}
        {items.length === 0 && !loading && (
          <Text size="xs" c="dimmed">暂无任务</Text>
        )}
      </List>
      {detail && (
        <Modal opened onClose={() => setDetail(null)} title="任务详情" size="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {detail.title}
            </Text>
            <Text size="xs" c="dimmed">
              清单：{listLabel(detail.list)} · 状态：{detail.done ? "已完成" : "未完成"}
            </Text>
            <Text size="xs" c="dimmed">
              创建 <RelativeTime value={detail.createdAt} /> · 更新 <RelativeTime value={detail.updatedAt} />
            </Text>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
