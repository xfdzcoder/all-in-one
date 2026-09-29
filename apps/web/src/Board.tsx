import { useCallback, useEffect, useRef, useState } from "react";
import { GridStack, useGridStack } from "gridstack/dist/react";
import type { GridStackHandle, GridStackWidget } from "gridstack/dist/react";
import { Alert, Button, Group, Text } from "@mantine/core";

import { api } from "./api";
import { FALLBACK_LAYOUT, widgetComponents } from "./widget-registry";
import { WidgetPicker } from "./WidgetPicker";
import { propsWithSecretRefs } from "./config-form-utils";

const SAVE_DEBOUNCE_MS = 800;

function parseLayout(json: string): GridStackWidget[] {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? (list as GridStackWidget[]) : FALLBACK_LAYOUT;
  } catch {
    return FALLBACK_LAYOUT;
  }
}

/** Host UI must live inside <GridStack> (wrapper constraint — useGridStack scope).
 *  Rendered after the grid root in DOM (wrapper design). */
function BoardToolbar({
  editMode,
  canEdit,
  dirty,
  onToggleEdit,
}: {
  editMode: boolean;
  canEdit: boolean;
  dirty: boolean;
  onToggleEdit: () => void;
}) {
  const { grid, addWidget, removeWidget } = useGridStack();
  const [pickerOpen, setPickerOpen] = useState(false);

  // ids must be unique across sessions — persisted layouts may already contain
  // t100/n100 from earlier runs; collisions leave the new portal empty (M2-④ 实测).
  const nextId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

  return (
    <Group mb="sm" gap="xs" style={{ position: "relative", zIndex: 2 }}>
      {canEdit && (
        <Button size="xs" variant={editMode ? "filled" : "default"} onClick={onToggleEdit}>
          {editMode ? "完成编辑" : "编辑布局"}
        </Button>
      )}
      {editMode && (
        <>
          <Button size="xs" variant="light" onClick={() => setPickerOpen(true)}>
            添加组件
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => {
              const items = grid?.getGridItems() ?? [];
              const last = items[items.length - 1];
              if (last) removeWidget(last);
            }}
          >
            删除最后
          </Button>
          <WidgetPicker
            opened={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onAdd={async (manifest, values) => {
              // SEC3：secret 字段的明文先入凭证库，props 只保存引用
              const props = await propsWithSecretRefs(manifest.configSchema, values, (name, secret) =>
                api.createCredential(name, secret),
              );
              addWidget({
                id: nextId("w"),
                x: 0,
                y: 100,
                w: manifest.defaultSize.w,
                h: manifest.defaultSize.h,
                component: manifest.type,
                props,
              });
            }}
          />
        </>
      )}
      {!canEdit && (
        <Text size="xs" c="dimmed">
          手机/平板仅浏览（D10）——布局编辑请在桌面端进行
        </Text>
      )}
      {dirty && (
        <Text size="xs" c="orange">
          保存中…
        </Text>
      )}
    </Group>
  );
}

export function Board({
  dashboardId,
  layoutJson,
  canEdit,
  onLayoutSaved,
}: {
  dashboardId: string;
  layoutJson: string;
  canEdit: boolean;
  onLayoutSaved: (dashboardId: string, layoutJson: string) => void;
}) {
  const gridRef = useRef<GridStackHandle>(null);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJson = useRef<string | null>(null);

  const effectiveEditMode = canEdit && editMode;

  // Capture layout ONCE per dashboard mount (key={dashboardId} remounts on switch).
  // The grid is the source of truth afterwards — keeping options stable prevents the
  // wrapper's updateOptions() from calling load(children) and resetting unsaved moves.
  const [options] = useState(() => ({
    column: 12,
    cellHeight: 80,
    margin: 6,
    mode: "float" as const,
    minRow: 1,
    disableDrag: true,
    disableResize: true,
    columnOpts: {
      breakpoints: [
        { w: 1200, c: 12 },
        { w: 900, c: 8 },
        { w: 600, c: 4 },
        { w: 480, c: 2 },
      ],
      layout: "moveScale" as const,
    },
    children: parseLayout(layoutJson),
  }));

  // Flush pending layout to server (debounced auto-save, FR-P4).
  const flush = useCallback(async () => {
    const json = pendingJson.current;
    if (json === null) return;
    pendingJson.current = null;
    try {
      await api.saveLayout(dashboardId, json);
      setDirty(false);
      setSaveError(null);
      onLayoutSaved(dashboardId, json);
    } catch {
      setSaveError("布局保存失败，稍后自动重试");
      setDirty(true);
      // keep pending for next change to retry
      pendingJson.current = json;
    }
  }, [dashboardId, onLayoutSaved]);

  const scheduleSave = useCallback(() => {
    const grid = gridRef.current?.getGrid();
    if (!grid) return;
    pendingJson.current = JSON.stringify(grid.save(false, false));
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Cleanup timer on unmount only (NOT on flush identity change — that would
  // prematurely flush mid-debounce after every parent re-render).
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flushRef.current();
    };
  }, []);

  // Toggle grid editability (D10: desktop-only, canEdit=false on mobile).
  // NOT done via options.staticGrid — that would change the options signature and
  // make the wrapper call updateOptions() → load(children), resetting the layout.
  useEffect(() => {
    const grid = gridRef.current?.getGrid();
    if (!grid) return;
    grid.enableMove(effectiveEditMode);
    grid.enableResize(effectiveEditMode);
  }, [effectiveEditMode]);

  return (
    <div>
      {saveError && (
        <Alert color="red" mb="sm">
          {saveError}
        </Alert>
      )}
      <GridStack
        ref={gridRef}
        key={dashboardId}
        options={options}
        components={widgetComponents}
        onChange={scheduleSave}
        onAdded={scheduleSave}
        onRemoved={scheduleSave}
      >
        <BoardToolbar
          editMode={effectiveEditMode}
          canEdit={canEdit}
          dirty={dirty}
          onToggleEdit={() => {
            setEditMode((v) => {
              const next = !v;
              if (!next) void flush();
              return next;
            });
          }}
        />
      </GridStack>
    </div>
  );
}
