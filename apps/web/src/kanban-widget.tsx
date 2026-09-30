import { useContext, useState } from "react";
import {
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useGridStack, useGridStackItem } from "gridstack/dist/react";
import type { GridStackWidget } from "gridstack/dist/react";

import type { KanbanCardRow } from "./api";
import { ConfirmAction } from "./confirm";
import { useKanbanBoards, useKanbanMutations, useKanbanTree } from "./data-hooks";
import { WidgetEditContext } from "./widget-edit-context";
import { WbAlert } from "./ui";

/**
 * Kanban 组件（二期 Q6b）：多项目看板、列与卡片、卡片操作（编辑/移动/归档/删除）。
 * 数据归 Workspace（D21），看板树经 REST 取数 + SSE 跨组件同步（FR-I6）。
 * 看板选择即组件配置：写回布局 props（FR-W4 配置变更路径）+ requestSave 持久化。
 * 卡片拖拽/嵌套手势见 Q6c（拖拽 vs 布局拖拽的冲突方案单独设计）。
 */

type NodeLike = { el?: HTMLElement; props?: Record<string, unknown> };

export function KanbanWidget({ boardId, refreshSec }: { boardId?: string; refreshSec?: number }) {
  const { editMode, requestSave } = useContext(WidgetEditContext);
  const { grid } = useGridStack();
  const { node } = useGridStackItem();
  const { boards, refresh: refreshBoards } = useKanbanBoards();
  const { tree, error, loading, refresh } = useKanbanTree(boardId, refreshSec);
  const m = useKanbanMutations(boardId);
  const [newBoard, setNewBoard] = useState("");
  const [newColumn, setNewColumn] = useState("");
  const [cardDrafts, setCardDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<KanbanCardRow | null>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  /** 组件内选择看板 = 配置变更：写回节点 props（宿主随后重渲染/持久化）。 */
  const selectBoard = (id: string) => {
    const n = node as NodeLike | undefined;
    if (grid && n?.el) {
      grid.update(n.el, { props: { ...(n.props ?? {}), boardId: id } } as GridStackWidget);
    }
    requestSave();
  };

  /** 卡片移动到目标列末尾（sortOrder = 该列最大 + 1；拖拽与「移动到」共用）。 */
  const moveCardTo = (cardId: string, columnId: string) => {
    const max = Math.max(
      -1,
      ...(tree?.cards ?? [])
        .filter((c) => c.columnId === columnId && !c.archived)
        .map((c) => c.sortOrder),
    );
    void m.patchCard(cardId, { columnId, sortOrder: max + 1 });
  };

  const createBoardAndSelect = async () => {
    const title = newBoard.trim();
    if (!title) return;
    const row = await m.createBoard(title);
    setNewBoard("");
    refreshBoards();
    selectBoard(row.id);
  };

  const cardsOf = (columnId: string) =>
    (tree?.cards ?? []).filter((c) => c.columnId === columnId && !c.archived);
  const archivedCount = (tree?.cards ?? []).filter((c) => c.archived).length;

  return (
    <div className="wb-widget">
      <Group gap={6} wrap="nowrap">
        <Select
          size="compact-xs"
          placeholder="选择看板"
          data={boards.map((b) => ({ value: b.id, label: b.title }))}
          value={boardId ?? null}
          onChange={(v) => v && selectBoard(v)}
          nothingFoundMessage="暂无看板"
          style={{ width: 150 }}
          aria-label="看板选择"
        />
        <TextInput
          size="compact-xs"
          placeholder="新看板名"
          value={newBoard}
          onChange={(e) => setNewBoard(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createBoardAndSelect();
          }}
          style={{ width: 110 }}
        />
        <Button size="compact-xs" variant="default" disabled={!newBoard.trim()} onClick={() => void createBoardAndSelect()}>
          新建看板
        </Button>
        <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
          刷新
        </Button>
        {archivedCount > 0 && (
          // ISS-13 修复：计数可点 —— 打开归档列表（恢复/删除），打通归档恢复路径
          <Button size="compact-xs" variant="subtle" onClick={() => setArchiveOpen(true)}>
            已归档 {archivedCount}
          </Button>
        )}
      </Group>

      {!boardId && (
        <Text size="xs" c="dimmed">
          选择或新建看板后显示列与卡片
        </Text>
      )}
      {boardId && editMode && (
        <Text size="xs" c="dimmed">
          编辑模式：拖动 = 调整布局，卡片暂不可拖（完成后可拖动卡片，或用卡片内「移动到」）
        </Text>
      )}
      {loading && (
        <Text size="xs" c="dimmed" className="wb-loading">加载中…</Text>
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {boardId && (
        <Group className="wb-kanban__board" gap="xs" wrap="nowrap">
          {(tree?.columns ?? []).map((col) => (
            <div
              key={col.id}
              className={`wb-kanban__col${dragOverCol === col.id ? " wb-kanban__col--drop" : ""}`}
              data-col-title={col.title}
              onDragOver={(e) => {
                // Q6c 拖拽冲突方案（D29）：仅浏览模式接卡片拖放；编辑模式让位布局拖拽
                if (!editMode) {
                  e.preventDefault();
                  setDragOverCol(col.id);
                }
              }}
              onDragLeave={() => setDragOverCol((v) => (v === col.id ? null : v))}
              onDrop={(e) => {
                if (editMode) return;
                e.preventDefault();
                setDragOverCol(null);
                const cardId = e.dataTransfer.getData("text/plain");
                if (cardId) moveCardTo(cardId, col.id);
              }}
            >
              <Group gap={4} wrap="nowrap" mb={4}>
                {editingCol === col.id ? (
                  <TextInput
                    size="compact-xs"
                    defaultValue={col.title}
                    className="wb-grow"
                    autoFocus
                    onBlur={(e) => {
                      const t = e.currentTarget.value.trim();
                      setEditingCol(null);
                      if (t && t !== col.title) void m.renameColumn(col.id, t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingCol(null);
                    }}
                  />
                ) : (
                  <Text
                    className="wb-kanban__col-title"
                    title="点击重命名"
                    onClick={() => setEditingCol(col.id)}
                  >
                    {col.title}
                  </Text>
                )}
                <ConfirmAction
                  label="×"
                  size="compact-xs"
                  variant="subtle"
                  title="删除列？"
                  message={`删除列「${col.title}」将一并删除其中 ${cardsOf(col.id).length} 张卡片（不可恢复）。确认删除？`}
                  onConfirm={() => void m.deleteColumn(col.id)}
                />
              </Group>
              <Stack gap={4}>
                {cardsOf(col.id).map((card) => (
                  <Card
                    key={card.id}
                    withBorder
                    padding={6}
                    radius={6}
                    className="wb-card--interactive"
                    style={{ cursor: "pointer" }}
                    draggable={!editMode}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragOverCol(null)}
                    onClick={() => setEditing(card)}
                  >
                    <Text size="xs">{card.title}</Text>
                    {card.body && (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {card.body}
                      </Text>
                    )}
                  </Card>
                ))}
                {dragOverCol === col.id && (
                  <div className="wb-kanban__drop-slot">放在这里</div>
                )}
                <Group gap={4} wrap="nowrap">
                  <TextInput
                    size="compact-xs"
                    placeholder="新卡片"
                    style={{ flex: 1 }}
                    value={cardDrafts[col.id] ?? ""}
                    onChange={(e) => {
                      // 注意：updater 会在渲染期被重放 —— 事件属性要先取值（currentTarget 事后为 null）
                      const v = e.currentTarget.value;
                      setCardDrafts((d) => ({ ...d, [col.id]: v }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const t = (cardDrafts[col.id] ?? "").trim();
                        if (t) {
                          void m.createCard(col.id, t);
                          setCardDrafts((d) => ({ ...d, [col.id]: "" }));
                        }
                      }
                    }}
                  />
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={!(cardDrafts[col.id] ?? "").trim()}
                    onClick={() => {
                      const t = (cardDrafts[col.id] ?? "").trim();
                      if (t) {
                        void m.createCard(col.id, t);
                        setCardDrafts((d) => ({ ...d, [col.id]: "" }));
                      }
                    }}
                  >
                    +
                  </Button>
                </Group>
              </Stack>
            </div>
          ))}
          <div style={{ width: 190, flexShrink: 0 }}>
            <Group gap={4} wrap="nowrap">
              <TextInput
                size="compact-xs"
                placeholder="新列名"
                style={{ flex: 1 }}
                value={newColumn}
                onChange={(e) => setNewColumn(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newColumn.trim()) {
                    void m.createColumn(newColumn.trim());
                    setNewColumn("");
                  }
                }}
              />
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={!newColumn.trim()}
                onClick={() => {
                  const t = newColumn.trim();
                  if (t) {
                    void m.createColumn(t);
                    setNewColumn("");
                  }
                }}
              >
                +
              </Button>
            </Group>
          </div>
        </Group>
      )}

      {archiveOpen && (
        <Modal opened onClose={() => setArchiveOpen(false)} title="已归档卡片" size="sm">
          <Stack gap="xs">
            {(tree?.cards ?? [])
              .filter((c) => c.archived)
              .map((card) => (
                <Group key={card.id} gap="xs" wrap="nowrap">
                  <div className="wb-grow">
                    <Text size="xs" fw={600} truncate>
                      {card.title}
                    </Text>
                    {card.body && (
                      <Text size="xs" c="dimmed" truncate>
                        {card.body}
                      </Text>
                    )}
                  </div>
                  <Button
                    size="compact-xs"
                    variant="default"
                    onClick={() => void m.patchCard(card.id, { archived: false })}
                  >
                    恢复
                  </Button>
                  <ConfirmAction
                    label="删除"
                    size="compact-xs"
                    variant="subtle"
                    title="删除卡片？"
                    message={`确认删除卡片「${card.title}」？（不可恢复）`}
                    onConfirm={() => void m.deleteCard(card.id)}
                  />
                </Group>
              ))}
            {(tree?.cards ?? []).filter((c) => c.archived).length === 0 && (
              <Text size="xs" c="dimmed">
                暂无归档卡片
              </Text>
            )}
          </Stack>
        </Modal>
      )}

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="卡片">
        {editing && (
          <Stack gap="xs">
            <TextInput
              label="标题"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.currentTarget.value })}
            />
            <Textarea
              label="描述"
              minRows={3}
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.currentTarget.value })}
            />
            <Select
              label="移动到"
              data={(tree?.columns ?? []).map((c) => ({ value: c.id, label: c.title }))}
              value={editing.columnId}
              onChange={(v) => {
                if (v && v !== editing.columnId) {
                  // 触控/键盘可达的移动备选（D29）：与拖拽同路径，落目标列末尾
                  moveCardTo(editing.id, v);
                  setEditing(null);
                }
              }}
            />
            <Group gap="xs">
              <Button
                size="xs"
                onClick={() => {
                  void m.patchCard(editing.id, { title: editing.title, body: editing.body });
                  setEditing(null);
                }}
              >
                保存
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  void m.patchCard(editing.id, { archived: !editing.archived });
                  setEditing(null);
                }}
              >
                {editing.archived ? "取消归档" : "归档"}
              </Button>
              <ConfirmAction
                label="删除"
                size="xs"
                variant="default"
                title="删除卡片？"
                message={`确认删除卡片「${editing.title}」？（不可恢复）`}
                onConfirm={() => {
                  void m.deleteCard(editing.id);
                  setEditing(null);
                }}
              />
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
