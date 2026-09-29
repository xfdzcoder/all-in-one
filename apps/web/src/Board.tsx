import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { GridStack, useGridStack } from "gridstack/dist/react";
import type { ComponentMap, GridStackHandle, GridStackWidget } from "gridstack/dist/react";
import { Utils } from "gridstack";
import type { ConfigValues, PluginManifest, WidgetManifest } from "@all-in-one/widget-sdk";
import { Alert, Button, Group, Modal, Text } from "@mantine/core";

import { api } from "./api";
import { FALLBACK_LAYOUT, manifestForComponent, widgetComponents } from "./widget-registry";
import { WidgetEditContext } from "./widget-edit-context";
import { withWidgetChrome } from "./widget-chrome";
import { WidgetPicker } from "./WidgetPicker";
import { ConfigForm } from "./ConfigForm";
import { PluginFrame } from "./plugin-frame";
import { usePlugins } from "./data-hooks";
import { propsWithSecretRefs } from "./config-form-utils";

const SAVE_DEBOUNCE_MS = 800;

/** 全部组件包上编辑态外框（配置入口），组件实现零改动（FR-W4 配置变更 / J8）。 */
const chromeComponents: ComponentMap = Object.fromEntries(
  Object.entries(widgetComponents).map(([key, Comp]) => [
    key,
    withWidgetChrome(Comp as ComponentType<Record<string, unknown>>),
  ]),
);

/** 启用中的插件绑定（组件 key = manifest.type，与内置组件同一注册路径）。 */
interface PluginBinding {
  id: string;
  manifest: PluginManifest;
}

/** 插件组件实例缓存（模块级）：列表刷新不重建组件 → 沙箱框不重挂载。 */
const pluginComponentCache = new Map<string, ComponentType<Record<string, unknown>>>();

/** gridstack 节点上的扩展字段（component/props 由 react 层透传，类型未声明）。 */
type NodeEx = GridStackWidget & { component?: string; props?: ConfigValues };

function findNode(grid: NonNullable<ReturnType<GridStackHandle["getGrid"]>>, id: string): NodeEx | undefined {
  return Utils.findInGrid(grid, id, true) as NodeEx | undefined;
}

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
  pluginManifests,
  onToggleEdit,
}: {
  editMode: boolean;
  canEdit: boolean;
  dirty: boolean;
  /** 启用中的插件 manifest（选择器清单动态合并，J8）。 */
  pluginManifests: WidgetManifest[];
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
            extraManifests={pluginManifests}
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

  // 启用中的插件 → 动态组件注册（组件 key = manifest.type，J8"新增组件不改核心"）
  const { plugins } = usePlugins();
  const pluginBindings = useMemo<PluginBinding[]>(
    () =>
      plugins
        .filter((p) => p.status === "enabled")
        .flatMap((p) => {
          try {
            return [{ id: p.id, manifest: JSON.parse(p.manifestJson) as PluginManifest }];
          } catch {
            return [];
          }
        }),
    [plugins],
  );
  const components = useMemo(() => {
    const map: ComponentMap = { ...chromeComponents };
    for (const b of pluginBindings) {
      // 每插件一个稳定组件实例（模块级缓存）——列表刷新不重挂载沙箱框
      let comp = pluginComponentCache.get(b.id);
      if (!comp) {
        const binding = b;
        comp = withWidgetChrome((props: Record<string, unknown>) => (
          <PluginFrame pluginId={binding.id} manifest={binding.manifest} config={props} />
        ));
        pluginComponentCache.set(b.id, comp);
      }
      map[b.manifest.type] = comp;
    }
    return map;
  }, [pluginBindings]);

  const manifestFor = useCallback(
    (component: string): WidgetManifest | undefined =>
      manifestForComponent(component) ??
      pluginBindings.find((b) => b.manifest.type === component)?.manifest,
    [pluginBindings],
  );
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

  // FR-W4 配置变更：编辑态组件外框的「配置」入口 → 该实例的 configSchema 表单。
  const [configureId, setConfigureId] = useState<string | null>(null);
  const [configManifest, setConfigManifest] = useState<WidgetManifest | null>(null);
  const [configValues, setConfigValues] = useState<ConfigValues>({});
  const [configOriginal, setConfigOriginal] = useState<ConfigValues>({});
  const [configError, setConfigError] = useState<string | null>(null);

  const openConfig = useCallback(
    (id: string) => {
      const grid = gridRef.current?.getGrid();
      const node = grid ? findNode(grid, id) : undefined;
      const manifest = node ? manifestFor(String(node.component ?? "")) : undefined;
      if (!grid || !node || !manifest) return;
      setConfigureId(id);
      setConfigManifest(manifest);
      setConfigValues({ ...(node.props ?? {}) });
      setConfigOriginal({ ...(node.props ?? {}) });
      setConfigError(null);
    },
    [manifestFor],
  );

  const saveConfig = useCallback(
    (values: ConfigValues) => {
      void (async () => {
        const grid = gridRef.current?.getGrid();
        const node = grid && configureId ? findNode(grid, configureId) : undefined;
        if (!grid || !node?.el || !configManifest) return;
        try {
          // SEC3：secret 字段明文入库凭证库，props 只保存引用；未改动的引用原样保留
          const props = await propsWithSecretRefs(
            configManifest.configSchema,
            values,
            (name, secret) => api.createCredential(name, secret),
            configOriginal,
          );
          grid.update(node.el, { props } as GridStackWidget);
          scheduleSave(); // props-only 更新不触发 change 事件，手动落盘（FR-P4）
          setConfigureId(null);
          setConfigManifest(null);
        } catch (e) {
          setConfigError(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [configureId, configManifest, configOriginal, scheduleSave],
  );

  return (
    <div>
      {saveError && (
        <Alert color="red" mb="sm">
          {saveError}
        </Alert>
      )}
      <WidgetEditContext.Provider
        value={{ editMode: effectiveEditMode, onConfigure: openConfig, requestSave: scheduleSave }}
      >
        <GridStack
          ref={gridRef}
          key={dashboardId}
          options={options}
          components={components}
        onChange={scheduleSave}
        onAdded={scheduleSave}
        onRemoved={scheduleSave}
      >
        <BoardToolbar
          editMode={effectiveEditMode}
          canEdit={canEdit}
          dirty={dirty}
          pluginManifests={pluginBindings.map((b) => b.manifest)}
          onToggleEdit={() => {
            setEditMode((v) => {
              const next = !v;
              if (!next) void flush();
              return next;
            });
          }}
        />
        </GridStack>
      </WidgetEditContext.Provider>
      {configureId !== null && configManifest !== null && (
        <Modal opened onClose={() => setConfigureId(null)} title={`配置 · ${configManifest.name}`}>
          <ConfigForm
            schema={configManifest.configSchema}
            values={configValues}
            onChange={(key, value) => setConfigValues((c) => ({ ...c, [key]: value }))}
            onSubmit={saveConfig}
            submitLabel="保存配置"
          />
          {configError && (
            <Text size="xs" c="red">
              {configError}
            </Text>
          )}
        </Modal>
      )}
    </div>
  );
}
