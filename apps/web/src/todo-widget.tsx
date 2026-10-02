import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Group, List, Modal, Stack, Text, TextInput } from "@mantine/core";

import type { TodoItem } from "./api";
import { ConfirmAction } from "./confirm";
import { useDraft, useTodoMutations, useTodos } from "./data-hooks";
import { RelativeTime, WbAlert, WbLoading, IconAction } from "./ui";
import { WidgetTitle } from "./widget-title";

/** Todo 组件配置（configSchema 元数据见 widget-manifests.ts）。
 *  gridstack 直接把布局 JSON 的 props 展开传入，即扁平 config 形态。 */
export type TodoConfig = {
  /** D43：卡片名称 = 任务分组名（全站唯一）。 */
  name?: string;
  /** 兼容旧布局（Q28 前为「清单」）—— 读取回落 name ?? list。 */
  list?: string;
  filter?: "open" | "done" | "all";
};

// D43：名称即分组名 —— 原样显示（用户自由命名）

/**
 * Todo Widget（FR：Workspace 级数据、勾选完成/新增）。
 * 数据来自 Workspace（D21），多个组件/页面共享同一份 —— J4 验证点。
 * 注：M2 内置组件直接消费工作台 REST + SSE（业务数据通道）；
 * 第三方数据类组件（custom-api）走服务端 connector 数据通道（M2-⑤）。
 */
export function TodoWidget({ name, list = "inbox", filter = "open", refreshSec }: TodoConfig & { refreshSec?: number }) {
  // D43：分组名 = 卡片名称（旧布局回落 list）
  const group = name ?? list ?? "我的待办";
  const { data, loading, error, refresh } = useTodos(group, refreshSec);
  const { create, toggle, remove } = useTodoMutations();
  const [draft, setDraft] = useDraft();
  const [detail, setDetail] = useState<TodoItem | null>(null);
  // ISS-14 修复：勾完即消失的过滤下提供「撤销」——文案只报计数不带标题（契约：完成后标题不可再见）
  const [undo, setUndo] = useState<{ ids: string[]; count: number } | null>(null);

  // Q29b：归档项不在组件显示（仅数据源管理可见）；filter 三档
  const items = (data ?? []).filter((t) =>
    filter === "open" ? !t.done : filter === "done" ? t.done : true,
  );

  // 撤销条 6 秒后自动消失
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <WidgetTitle title={<>Todo · {group}</>} size="sm" truncate={false} />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={refresh}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>
      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder="新任务…"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              create.mutate({ title: draft.trim(), list: group });
              setDraft("");
            }
          }}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          disabled={!draft.trim()}
          onClick={() => {
            create.mutate({ title: draft.trim(), list: group });
            setDraft("");
          }}
        >
          添加
        </Button>
      </Group>
      {undo && undo.count > 0 && (
        <div className="wb-undo">
          <Text size="xs">已完成 {undo.count} 项任务</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => {
              for (const id of undo.ids) toggle.mutate({ id, done: false });
              setUndo(null);
            }}
          >
            撤销
          </Button>
        </div>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      <List listStyleType="none" style={{ flex: 1, overflow: "auto" }}>
        {items.map((t) => (
          <List.Item key={t.id}>
            <Group gap="xs" wrap="nowrap">
              <Checkbox
                checked={t.done}
                onChange={(e) => {
                  const done = e.currentTarget.checked;
                  toggle.mutate({ id: t.id, done });
                  // Q27d#3：计数累计（完成多项不再恒显 1 项）；撤销回滚本轮全部
                  if (done) setUndo((u) => ({ ids: [...(u?.ids ?? []), t.id], count: (u?.count ?? 0) + 1 }));
                  else setUndo((u) => (u ? { ids: u.ids.filter((x) => x !== t.id), count: Math.max(0, u.count - 1) } : null));
                }}
                aria-label={`完成状态：${t.title}`}
              />
              <Text
                size="sm"
                component="button"
                type="button"
                className="wb-btn-reset"
                style={{ flex: 1, textDecoration: t.done ? "line-through" : undefined, cursor: "pointer" }}
                onClick={() => setDetail(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetail(t);
                  }
                }}
              >
                {t.title}
              </Text>
              <ConfirmAction
                label="×"
                ariaLabel={`删除任务：${t.title}`}
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
              分组：{detail.list} · 状态：{detail.done ? "已完成" : "未完成"}
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
