import { Button, Checkbox, Group, List, Stack, Text, TextInput } from "@mantine/core";

import { useDraft, useTodoMutations, useTodos } from "./data-hooks";

/** Todo 组件配置（configSchema 元数据见 widget-manifests.ts）。
 *  gridstack 直接把布局 JSON 的 props 展开传入，即扁平 config 形态。 */
export type TodoConfig = {
  list?: string;
  filter?: "open" | "all";
};

/**
 * Todo Widget（FR：Workspace 级数据、勾选完成/新增）。
 * 数据来自 Workspace（D21），多个组件/页面共享同一份 —— J4 验证点。
 * 注：M2 内置组件直接消费工作台 REST + SSE（业务数据通道）；
 * 第三方数据类组件（custom-api）走服务端 connector 数据通道（M2-⑤）。
 */
export function TodoWidget({ list = "inbox", filter = "open", refreshSec }: TodoConfig & { refreshSec?: number }) {
  const { data, loading, error } = useTodos(list, refreshSec);
  const { create, toggle, remove } = useTodoMutations();
  const [draft, setDraft] = useDraft();

  const items = (data ?? []).filter((t) => (filter === "open" ? !t.done : true));

  return (
    <Stack gap="xs" style={{ height: "100%", overflow: "auto", padding: 4 }}>
      <Text size="sm" fw={600}>
        Todo · {list}
      </Text>
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
      {error && <Text size="xs" c="red">{error}</Text>}
      <List listStyleType="none" style={{ flex: 1, overflow: "auto" }}>
        {items.map((t) => (
          <List.Item key={t.id}>
            <Group gap="xs" wrap="nowrap">
              <Checkbox
                checked={t.done}
                onChange={(e) => toggle.mutate({ id: t.id, done: e.currentTarget.checked })}
                aria-label={`toggle ${t.title}`}
              />
              <Text size="sm" style={{ flex: 1, textDecoration: t.done ? "line-through" : undefined }}>
                {t.title}
              </Text>
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => remove.mutate(t.id)}>
                ×
              </Button>
            </Group>
          </List.Item>
        ))}
        {items.length === 0 && !loading && (
          <Text size="xs" c="dimmed">暂无任务</Text>
        )}
      </List>
    </Stack>
  );
}
