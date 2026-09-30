import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import type { FeedSource, TagRow, TodoItem } from "./api";
import { ConfirmAction } from "./confirm";
import {
  useDraft,
  useFeedMutations,
  useFeedSources,
  useTagMutations,
  useTags,
  useTodoMutations,
  useTodos,
} from "./data-hooks";
import { TagInput } from "./tag-input";
import { WbAlert } from "./ui";
import { listLabel } from "./widget-registry";

/**
 * 数据源管理（FR-D2/D40；Q25c/#2 由弹窗改为**独立全页**——大数量好展示）：
 * 任务 / 信息源 / 标签 三区；顶部搜索 + 逐行打标签（TagInput：输入搜索/回车即建）。
 * 卡片只做视图（数据/视图分离）：组件按标签选数据（FR-D3）。
 */

const TAG_COLORS = [
  { value: "", label: "默认" },
  { value: "blue", label: "蓝" },
  { value: "green", label: "绿" },
  { value: "orange", label: "橙" },
  { value: "red", label: "红" },
  { value: "violet", label: "紫" },
  { value: "teal", label: "青" },
];

export function DataAdmin({ onBack }: { onBack: () => void }) {
  const todos = useTodos();
  const sources = useFeedSources();
  const tags = useTags();
  const tagMut = useTagMutations();
  const todoMut = useTodoMutations();
  const feedMut = useFeedMutations();
  const [newTodo, setNewTodo] = useDraft();
  const [newSourceTitle, setNewSourceTitle] = useDraft();
  const [newSourceUrl, setNewSourceUrl] = useDraft();
  const [newTagName, setNewTagName] = useDraft();
  const [newTagColor, setNewTagColor] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // Q25c/#2：搜索（标题/URL/清单名/标签名）
  const [q, setQ] = useState("");

  const tagRows = tags.data ?? [];

  return (
    <div className="wb-admin">
      <div className="wb-admin__bar">
        <Button variant="default" size="xs" onClick={onBack}>
          ← 返回工作台
        </Button>
        <Title order={4} className="wb-admin__title">
          数据源管理
        </Title>
        <TextInput
          size="xs"
          className="wb-admin__search"
          placeholder="搜索任务 / 订阅源 / 标签…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      {error && (
        <WbAlert tone="error" size="sm" onClose={() => setError(null)}>
          {error}
        </WbAlert>
      )}
      <Tabs defaultValue="todo">
        <Tabs.List>
          <Tabs.Tab value="todo">任务</Tabs.Tab>
          <Tabs.Tab value="feeds">信息源</Tabs.Tab>
          <Tabs.Tab value="tags">标签</Tabs.Tab>
        </Tabs.List>

        {/* ── 任务（Workspace 级，D21） ── */}
        <Tabs.Panel value="todo" pt="xs">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <TextInput
                size="xs"
                placeholder="新任务…"
                value={newTodo}
                onChange={(e) => setNewTodo(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTodo.trim()) {
                    todoMut.create.mutate({ title: newTodo.trim() });
                    setNewTodo("");
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                disabled={!newTodo.trim()}
                onClick={() => {
                  todoMut.create.mutate({ title: newTodo.trim() });
                  setNewTodo("");
                }}
              >
                添加
              </Button>
            </Group>
            <div className="wb-admin__table">
              {(todos.data ?? [])
                .filter((t: TodoItem) => !q || t.title.includes(q) || listLabel(t.list).includes(q))
                .map((t: TodoItem) => (
                  <div key={t.id} className="wb-admin__row" data-admin-row="todo">
                    <Checkbox
                      checked={t.done}
                      onChange={(e) => todoMut.toggle.mutate({ id: t.id, done: e.currentTarget.checked })}
                      aria-label={`toggle ${t.title}`}
                    />
                    <Text size="sm" className="wb-grow" truncate>
                      {t.title}
                    </Text>
                    <Badge size="xs" variant="outline">
                      {listLabel(t.list)}
                    </Badge>
                    <TagInput
                      tags={tagRows}
                      value={t.tagIds ?? []}
                      onChange={(tagIds) =>
                        tagMut.setTarget.mutate({ targetType: "todo", targetId: t.id, tagIds })
                      }
                      width={220}
                    />
                    <ConfirmAction
                      label="×"
                      size="compact-xs"
                      variant="subtle"
                      title="删除任务？"
                      message={`确认删除任务「${t.title}」？（不可恢复）`}
                      onConfirm={() => todoMut.remove.mutate(t.id)}
                    />
                  </div>
                ))}
              {(todos.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">
                  暂无任务
                </Text>
              )}
            </div>
          </Stack>
        </Tabs.Panel>

        {/* ── 信息源（RSS 订阅） ── */}
        <Tabs.Panel value="feeds" pt="xs">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <TextInput
                size="xs"
                placeholder="标题"
                value={newSourceTitle}
                onChange={(e) => setNewSourceTitle(e.currentTarget.value)}
                style={{ width: 130 }}
              />
              <TextInput
                size="xs"
                placeholder="https://…/feed.xml"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSourceUrl.trim()) {
                    feedMut.addSource.mutate(
                      { title: newSourceTitle.trim() || "订阅", url: newSourceUrl.trim() },
                      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                    );
                    setNewSourceUrl("");
                    setNewSourceTitle("");
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                disabled={!newSourceUrl.trim()}
                onClick={() => {
                  feedMut.addSource.mutate(
                    { title: newSourceTitle.trim() || "订阅", url: newSourceUrl.trim() },
                    { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                  );
                  setNewSourceUrl("");
                  setNewSourceTitle("");
                }}
              >
                订阅
              </Button>
            </Group>
            <div className="wb-admin__table">
              {(sources.data ?? [])
                .filter((src: FeedSource) => !q || src.title.includes(q) || src.url.includes(q))
                .map((s: FeedSource) => (
                  <div key={s.id} className="wb-admin__row" data-admin-row="feed">
                    <Text size="sm" fw={600} style={{ width: 140 }} truncate>
                      {s.title}
                    </Text>
                    <Text size="xs" c="dimmed" className="wb-grow" truncate>
                      {s.url}
                    </Text>
                    <TagInput
                      tags={tagRows}
                      value={s.tagIds ?? []}
                      onChange={(tagIds) =>
                        tagMut.setTarget.mutate({ targetType: "feed", targetId: s.id, tagIds })
                      }
                      width={220}
                    />
                    <ConfirmAction
                      label="退订"
                      size="compact-xs"
                      variant="subtle"
                      title="确认退订？"
                      message={`确认退订「${s.title}」？（已读标记保留，可随时重新订阅）`}
                      onConfirm={() => feedMut.removeSource.mutate(s.id)}
                    />
                  </div>
                ))}
              {(sources.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">
                  暂无订阅源
                </Text>
              )}
            </div>
          </Stack>
        </Tabs.Panel>

        {/* ── 标签 ── */}
        <Tabs.Panel value="tags" pt="xs">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <TextInput
                size="xs"
                placeholder="新标签名（行内打标签可直接回车创建）"
                value={newTagName}
                onChange={(e) => setNewTagName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim()) {
                    tagMut.create.mutate(
                      { name: newTagName.trim(), color: newTagColor || undefined },
                      { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                    );
                    setNewTagName("");
                  }
                }}
                style={{ flex: 1 }}
              />
              <Select
                size="xs"
                data={TAG_COLORS}
                value={newTagColor}
                onChange={(v) => setNewTagColor(v ?? "")}
                style={{ width: 90 }}
                aria-label="标签颜色"
              />
              <Button
                size="xs"
                disabled={!newTagName.trim()}
                onClick={() => {
                  tagMut.create.mutate(
                    { name: newTagName.trim(), color: newTagColor || undefined },
                    { onError: (err) => setError(err instanceof Error ? err.message : String(err)) },
                  );
                  setNewTagName("");
                }}
              >
                添加
              </Button>
            </Group>
            <div className="wb-admin__table">
              {tagRows.filter((t: TagRow) => !q || t.name.includes(q)).map((t: TagRow) => (
                <div key={t.id} className="wb-admin__row" data-admin-row="tag">
                  <TextInput
                    size="xs"
                    defaultValue={t.name}
                    className="wb-grow"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== t.name) tagMut.update.mutate({ id: t.id, name: v });
                    }}
                  />
                  <Select
                    size="xs"
                    data={TAG_COLORS}
                    value={t.color ?? ""}
                    onChange={(v) => tagMut.update.mutate({ id: t.id, color: v || null })}
                    style={{ width: 90 }}
                    aria-label={`标签颜色 ${t.name}`}
                  />
                  <Text size="xs" c="dimmed" style={{ width: 64 }}>
                    {t.targetCount} 项
                  </Text>
                  <ConfirmAction
                    label="×"
                    size="compact-xs"
                    variant="subtle"
                    title="删除标签？"
                    message={`确认删除标签「${t.name}」？（仅移除标签与关联，Todo/订阅数据保留）`}
                    onConfirm={() => tagMut.remove.mutate(t.id)}
                  />
                </div>
              ))}
              {tagRows.length === 0 && (
                <Text size="xs" c="dimmed">
                  暂无标签 —— 新建后即可给任务与订阅源打标
                </Text>
              )}
            </div>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
