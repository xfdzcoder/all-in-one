import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";

import type { FeedSource, TagRow, TodoItem } from "./api";
import { ConfirmAction } from "./confirm";
import { useDraft, useFeedMutations, useFeedSources, useTagMutations, useTags, useTodoMutations, useTodos } from "./data-hooks";
import { WbAlert } from "./ui";
import { listLabel } from "./widget-registry";

/**
 * 数据管理（FR-D2 / D40）：Workspace 级数据的统一管理处。
 * 三页签：Todo / 信息源 / 标签 —— 增改删 + 打标签；退订与删除带确认（D34）。
 * 卡片只做视图（数据/视图分离）：Todo/RSS 组件在此管理数据后按标签选数据（FR-D3）。
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

export function DataAdmin({ opened, onClose }: { opened: boolean; onClose: () => void }) {
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
  // ISS-26：列表搜索（标题/URL/名称）
  const [q, setQ] = useState("");

  const tagOptions = (tags.data ?? []).map((t: TagRow) => ({ value: t.id, label: t.name }));

  return (
    <Modal opened={opened} onClose={onClose} title="数据管理" size="lg">
      <Stack gap="sm">
        {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
        <TextInput
          size="xs"
          placeholder="搜索任务 / 订阅源 / 标签…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Tabs defaultValue="todo">
          <Tabs.List>
            <Tabs.Tab value="todo">Todo</Tabs.Tab>
            <Tabs.Tab value="feeds">信息源</Tabs.Tab>
            <Tabs.Tab value="tags">标签</Tabs.Tab>
          </Tabs.List>

          {/* ── Todo：清单数据（Workspace 级，D21） ── */}
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
              {(todos.data ?? []).filter((t: TodoItem) => !q || t.title.includes(q) || listLabel(t.list).includes(q)).map((t: TodoItem) => (
                <Group key={t.id} gap="xs" wrap="nowrap">
                  <Checkbox
                    checked={t.done}
                    onChange={(e) => todoMut.toggle.mutate({ id: t.id, done: e.currentTarget.checked })}
                    aria-label={`toggle ${t.title}`}
                  />
                  <Text size="xs" className="wb-grow" truncate>
                    {t.title}
                  </Text>
                  <Badge size="xs" variant="outline">
                    {listLabel(t.list)}
                  </Badge>
                  <MultiSelect
                    size="xs"
                    placeholder="标签"
                    data={tagOptions}
                    value={t.tagIds ?? []}
                    onChange={(v) =>
                      tagMut.setTarget.mutate({ targetType: "todo", targetId: t.id, tagIds: v })
                    }
                    style={{ width: 180 }}
                  />
                  <ConfirmAction
                    label="×"
                    size="compact-xs"
                    variant="subtle"
                    title="删除任务？"
                    message={`确认删除任务「${t.title}」？（不可恢复）`}
                    onConfirm={() => todoMut.remove.mutate(t.id)}
                  />
                </Group>
              ))}
              {(todos.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">暂无任务</Text>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── 信息源：RSS 订阅（退订带确认） ── */}
          <Tabs.Panel value="feeds" pt="xs">
            <Stack gap="xs">
              <Group gap="xs" wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder="标题"
                  value={newSourceTitle}
                  onChange={(e) => setNewSourceTitle(e.currentTarget.value)}
                  style={{ width: 110 }}
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
              {(sources.data ?? []).filter((src: FeedSource) => !q || src.title.includes(q) || src.url.includes(q)).map((s: FeedSource) => (
                <Group key={s.id} gap="xs" wrap="nowrap">
                  <Text size="xs" fw={600} style={{ width: 110 }} truncate>
                    {s.title}
                  </Text>
                  <Text size="xs" c="dimmed" className="wb-grow" truncate>
                    {s.url}
                  </Text>
                  <MultiSelect
                    size="xs"
                    placeholder="标签"
                    data={tagOptions}
                    value={s.tagIds ?? []}
                    onChange={(v) =>
                      tagMut.setTarget.mutate({ targetType: "feed", targetId: s.id, tagIds: v })
                    }
                    style={{ width: 180 }}
                  />
                  <ConfirmAction
                    label="退订"
                    size="compact-xs"
                    variant="subtle"
                    title="确认退订？"
                    message={`确认退订「${s.title}」？（已读标记保留，可随时重新订阅）`}
                    onConfirm={() => feedMut.removeSource.mutate(s.id)}
                  />
                </Group>
              ))}
              {(sources.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">暂无订阅源</Text>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── 标签：新建/重命名/删除（FR-D1） ── */}
          <Tabs.Panel value="tags" pt="xs">
            <Stack gap="xs">
              <Group gap="xs" wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder="新标签名"
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
              {(tags.data ?? []).filter((t: TagRow) => !q || t.name.includes(q)).map((t: TagRow) => (
                <Group key={t.id} gap="xs" wrap="nowrap">
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
                </Group>
              ))}
              {(tags.data ?? []).length === 0 && (
                <Text size="xs" c="dimmed">暂无标签 —— 新建后即可给 Todo 与订阅源打标</Text>
              )}
              <Text size="xs" c="dimmed">
                标签是视图维度：{tagOptions.length > 0 ? `当前 ${tagOptions.length} 个标签（${tagOptions.map((o) => o.label).join("、")}）` : "删除标签不影响数据"}
                ；组件里用「筛选」按标签选数据。
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}
