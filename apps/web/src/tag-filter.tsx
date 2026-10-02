import { useContext, useState } from "react";
import { Button, Checkbox, Modal, Stack, Text } from "@mantine/core";
import { useGridStack, useGridStackItem } from "gridstack/dist/react";
import type { GridStackWidget } from "gridstack/dist/react";

import { useTags } from "./data-hooks";
import { WidgetEditContext } from "./widget-edit-context";

type NodeLike = { el?: HTMLElement; props?: Record<string, unknown> };

/**
 * 组件标签筛选（FR-D3 / D40）：勾选 → 写回组件配置 props.tagIds（D28 requestSave 同款，
 * 与看板组件内选看板一致）；数据由服务端按标签过滤（非前端过滤）。
 */
export function TagFilter({
  value,
  targetLabel,
}: {
  value?: string[];
  targetLabel: string;
}) {
  const { requestSave } = useContext(WidgetEditContext);
  const { grid } = useGridStack();
  const { node } = useGridStackItem();
  const tags = useTags();
  const [open, setOpen] = useState(false);
  const selected = value ?? [];

  const apply = (tagIds: string[]) => {
    const n = node as NodeLike | undefined;
    if (grid && n?.el) {
      grid.update(n.el, { props: { ...n.props, tagIds } } as GridStackWidget);
    }
    requestSave();
  };

  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={() => setOpen(true)}>
        {selected.length > 0 ? `筛选 (${selected.length})` : "筛选"}
      </Button>
      {open && (
        <Modal opened onClose={() => setOpen(false)} title="按标签筛选" size="sm">
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              勾选 = 只显示含任一所选标签的{targetLabel}；不勾 = 全部。选择即保存为组件配置。
            </Text>
            {(tags.data ?? []).map((t) => (
              <Checkbox
                key={t.id}
                label={t.name}
                checked={selected.includes(t.id)}
                onChange={(e) =>
                  apply(
                    e.currentTarget.checked
                      ? [...selected, t.id]
                      : selected.filter((x) => x !== t.id),
                  )
                }
              />
            ))}
            {(tags.data ?? []).length === 0 && (
              <Text size="xs" c="dimmed">
                暂无标签 —— 在头部「数据管理」创建标签并给数据打标
              </Text>
            )}
            <Button size="xs" variant="default" onClick={() => apply([])}>
              清除筛选
            </Button>
          </Stack>
        </Modal>
      )}
    </>
  );
}
