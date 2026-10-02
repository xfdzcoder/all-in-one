import { IconRefresh } from "@tabler/icons-react";
import { Fragment, useContext, useRef, useState } from "react";
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

import type { KanbanCardRow } from "./api";
import { ConfirmAction } from "./confirm";
import { useKanbanBoards, useKanbanMutations, useKanbanTree } from "./data-hooks";
import { WidgetEditContext } from "./widget-edit-context";
import { WidgetTitle } from "./widget-title";
import { WbAlert, WbLoading, IconAction } from "./ui";
import { reportError } from "./feedback";

/**
 * Kanban 组件（二期 Q6b）：多项目看板、列与卡片、卡片操作（编辑/移动/归档/删除）。
 * 数据归 Workspace（D21），看板树经 REST 取数 + SSE 跨组件同步（FR-I6）。
 * 看板选择即组件配置：写回布局 props（FR-W4 配置变更路径）+ requestSave 持久化。
 * 卡片拖拽/嵌套手势见 Q6c（拖拽 vs 布局拖拽的冲突方案单独设计）。
 */

export function KanbanWidget({ boardId, refreshSec }: { boardId?: string; refreshSec?: number }) {
  const { editMode } = useContext(WidgetEditContext);
  const { boards } = useKanbanBoards();
  const { tree, error, loading, refresh } = useKanbanTree(boardId, refreshSec);
  const m = useKanbanMutations(boardId);
  // Q26c#2/Q27d#2：卡片 composer（整列点按触发）；加列在「数据源管理 · 看板」
  const [addingCardCol, setAddingCardCol] = useState<string | null>(null);
  const [cardDrafts, setCardDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<KanbanCardRow | null>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  // Q25b（B 方案）：拖拽落点 = 目标列 + 插入索引（占位跟随指针；松手中插）。
  // state 供渲染；ref 同步记录供 drop 读取（setState 异步 —— 快速落下时闭包会拿到旧值）。
  const [dropTarget, setDropTarget] = useState<{ colId: string; index: number } | null>(null);
  const dropTargetRef = useRef<{ colId: string; index: number } | null>(null);
  // 拖拽中的卡 id：插入索引按「其余卡」坐标计算（与 moveCardToIndex 的 others 语义一致，
  // 同列移动不再差一格）；ref 同步供 dragover 过滤
  const draggingIdRef = useRef<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);


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

  /** B 方案：拖拽中插 —— 目标列按序重排，落点插入（含同列移动的索引修正）。 */
  const moveCardToIndex = (cardId: string, columnId: string, index: number) => {
    const others = (tree?.cards ?? [])
      .filter((c) => c.columnId === columnId && !c.archived && c.id !== cardId)
      .toSorted((a, b) => a.sortOrder - b.sortOrder);
    const clamped = Math.max(0, Math.min(index, others.length));
    const next = [...others.slice(0, clamped), { id: cardId }, ...others.slice(clamped)];
    const moving = (tree?.cards ?? []).find((c) => c.id === cardId);
    const ops = next.map((c, i) => {
      const row = (tree?.cards ?? []).find((x) => x.id === c.id);
      const sameCol = row?.columnId === columnId;
      if (!row && moving) return m.patchCard(cardId, { columnId, sortOrder: i });
      if (row && (row.sortOrder !== i || !sameCol)) return m.patchCard(c.id, { columnId, sortOrder: i });
      return null;
    });
    void Promise.all(ops.filter(Boolean)).catch((e) => reportError("看板卡片排序保存失败", e)); // WEB-4
  };


  const cardsOf = (columnId: string) =>
    (tree?.cards ?? []).filter((c) => c.columnId === columnId && !c.archived);
  const archivedCount = (tree?.cards ?? []).filter((c) => c.archived).length;

  return (
    <div className="wb-widget">
      <Group gap={6} wrap="nowrap">
        <WidgetTitle
          title={boards.find((b) => b.id === boardId)?.title ?? "看板"}
          className="wb-grow wb-kanban__board-title"
        />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "kanban" } }))}
          >
            管理
          </Button>
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
          {archivedCount > 0 && (
            // ISS-13 修复：计数可点 —— 打开归档列表（恢复/删除），打通归档恢复路径
            <Button size="compact-xs" variant="subtle" onClick={() => setArchiveOpen(true)}>
              已归档 {archivedCount}
            </Button>
          )}
        </Group>
      </Group>

      {!boardId && (
        // 五.1：无看板可选 → 引导去数据源管理创建
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂无看板可选 —— 请到「数据源管理 · 看板」创建
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "kanban" } }))}
          >
            去创建看板
          </Button>
        </div>
      )}
      {boardId && editMode && (
        <Text size="xs" c="dimmed">
          编辑模式：拖动 = 调整布局，卡片暂不可拖（完成后可拖动卡片，或用卡片内「移动到」）
        </Text>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {boardId && (
        <Group className="wb-kanban__board" gap="xs" wrap="nowrap">
          {(tree?.columns ?? []).map((col) => ( // oxlint-disable-line react/refs -- tree 是 useKanbanTree 的查询数据，非 ref，规则误判
            <div
              key={col.id}
              className={`wb-kanban__col${dropTarget?.colId === col.id ? " wb-kanban__col--drop" : ""}`}
              data-col-title={col.title}
              onDragOver={(e) => {
                // Q6c 拖拽冲突方案（D29）：仅浏览模式接卡片拖放；编辑模式让位布局拖拽
                if (editMode) return;
                e.preventDefault();
                // B 方案：按鼠标 Y 计算插入索引（两卡中点为界）；值不变不置态（防抖动）
                const cards = [...e.currentTarget.querySelectorAll("[data-card-id]")].filter(
                  (el) => el.getAttribute("data-card-id") !== draggingIdRef.current,
                );
                let index = cards.length;
                for (let i = 0; i < cards.length; i += 1) {
                  const r = cards[i].getBoundingClientRect();
                  if (e.clientY < r.top + r.height / 2) {
                    index = i;
                    break;
                  }
                }
                const next = { colId: col.id, index };
                if (!(dropTargetRef.current && dropTargetRef.current.colId === col.id && dropTargetRef.current.index === index)) {
                  dropTargetRef.current = next;
                  setDropTarget(next);
                }
              }}
              onDragLeave={(e) => {
                // 闪烁修复：仍在列内（子元素间冒泡）不置空；真离开（relatedTarget 在列外）才清
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                dropTargetRef.current = null;
                setDropTarget(null);
              }}
              onDrop={(e) => {
                if (editMode) return;
                e.preventDefault();
                const cardId = e.dataTransfer.getData("text/plain");
                const target = dropTargetRef.current;
                dropTargetRef.current = null;
                setDropTarget(null);
                if (!cardId) return;
                if (target && target.colId === col.id) moveCardToIndex(cardId, col.id, target.index);
                else moveCardTo(cardId, col.id);
              }}
            >
              <Group gap={4} wrap="nowrap" mb={4}>
                {editingCol === col.id ? (
                  <TextInput
                    size="xs"
                    defaultValue={col.title}
                    className="wb-grow"
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- 行内编辑器「点开即输入」是交互契约（重命名/新增卡），移除属 UX 回归；仅瞬态输入框、非页面首焦
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
                    component="button"
                    type="button"
                    className="wb-kanban__col-title wb-btn-reset"
                    title="点击重命名"
                    onClick={() => setEditingCol(col.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditingCol(col.id);
                      }
                    }}
                  >
                    {col.title}
                  </Text>
                )}

              </Group>
              <Stack gap={4}>
                {cardsOf(col.id).map((card, cardIdx) => {
                  // 占位索引从「其余卡」坐标换算回全列表坐标（跳过拖拽中的卡）
                  let slotIdx = -1;
                  if (dropTarget?.colId === col.id) {
                    let seen = 0;
                    const full = cardsOf(col.id);
                    for (let i = 0; i < full.length; i += 1) {
                      if (full[i].id === draggingIdRef.current) continue;
                      if (seen === dropTarget.index) {
                        slotIdx = i;
                        break;
                      }
                      seen += 1;
                    }
                    if (slotIdx === -1) slotIdx = full.length;
                  }
                  return (
                  <Fragment key={card.id}>
                    {dropTarget?.colId === col.id && slotIdx === cardIdx && (
                      <div className="wb-kanban__drop-slot wb-kanban__drop-slot--inline">放在这里</div>
                    )}
                    <Card
                    key={card.id}
                    data-card-id={card.id}
                    component="button"
                    type="button"
                    withBorder
                    padding={6}
                    radius={6}
                    className="wb-card--interactive"
                    style={{ cursor: "pointer", textAlign: "inherit" }}
                    draggable={!editMode}
                    onDragStart={(e) => {
                      draggingIdRef.current = card.id;
                      e.dataTransfer.setData("text/plain", card.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      draggingIdRef.current = null;
                      dropTargetRef.current = null;
                      setDropTarget(null);
                    }}
                    onClick={() => setEditing(card)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(card);
                      }
                    }}
                  >
                    <Text size="xs">{card.title}</Text>
                    {card.body && (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {card.body}
                      </Text>
                    )}
                    </Card>
                  </Fragment>
                  );
                })}
                {dropTarget?.colId === col.id && (() => {
                  const full = cardsOf(col.id);
                  let seen = 0;
                  let slotIdx = full.length;
                  for (let i = 0; i < full.length; i += 1) {
                    if (full[i].id === draggingIdRef.current) continue;
                    if (seen === dropTarget.index) {
                      slotIdx = i;
                      break;
                    }
                    seen += 1;
                  }
                  return slotIdx >= full.length ? (
                    <div className="wb-kanban__drop-slot wb-kanban__drop-slot--inline">放在这里</div>
                  ) : null;
                })()}
                {addingCardCol === col.id ? (
                  <div className="wb-composer">
                    <TextInput
                      size="xs"
                      placeholder="卡片标题"
                      // oxlint-disable-next-line jsx-a11y/no-autofocus -- 行内编辑器「点开即输入」是交互契约（重命名/新增卡），移除属 UX 回归；仅瞬态输入框、非页面首焦
                      autoFocus
                      value={cardDrafts[col.id] ?? ""}
                      onChange={(e) => {
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
                        if (e.key === "Escape") setAddingCardCol(null);
                      }}
                    />
                    <Group gap={4}>
                      <Button
                        size="compact-xs"
                        disabled={!(cardDrafts[col.id] ?? "").trim()}
                        onClick={() => {
                          const t = (cardDrafts[col.id] ?? "").trim();
                          if (t) {
                            void m.createCard(col.id, t);
                            setCardDrafts((d) => ({ ...d, [col.id]: "" }));
                          }
                        }}
                      >
                        添加
                      </Button>
                      <Button size="compact-xs" variant="subtle" onClick={() => setAddingCardCol(null)}>
                        取消
                      </Button>
                    </Group>
                  </div>
                ) : (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    className="wb-ghost-add"
                    onClick={() => setAddingCardCol(col.id)}
                  >
                    ＋ 添加卡片
                  </Button>
                )}
              </Stack>
            </div>
          ))}
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

      {/* WEB-16：条件挂载（confirm.tsx:46 教训）——原 `opened={editing !== null}` 常驻挂载，
          多卡看板长期多挂一棵 Modal 子树；关窗即卸载，DOM 不膨胀 */}
      {editing && (
      <Modal opened onClose={() => setEditing(null)} title="卡片">
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
      )}
    </div>
  );
}
