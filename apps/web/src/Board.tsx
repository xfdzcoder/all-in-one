import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentType } from "react";
import { GridStack, useGridStack } from "gridstack/dist/react";
import type { ComponentMap, GridStackHandle, GridStackWidget } from "gridstack/dist/react";
import { Utils } from "gridstack";
import type { ConfigValues, PluginManifest, WidgetManifest } from "@all-in-one/widget-sdk";
import { Button, Group, Modal, Text } from "@mantine/core";

import { api } from "./api";
import { randomId } from "./random-id";
import { FALLBACK_LAYOUT, manifestForComponent, widgetComponents } from "./widget-registry";
import { WidgetEditContext } from "./widget-edit-context";
import { withWidgetChrome } from "./widget-chrome";
import { WidgetPicker } from "./WidgetPicker";
import { ConfigForm } from "./ConfigForm";
import { PluginFrame } from "./plugin-frame";
import { usePlugins } from "./data-hooks";
import { propsWithSecretRefs } from "./config-form-utils";
import { WbAlert } from "./ui";

const SAVE_DEBOUNCE_MS = 800;

/**
 * 唯一字段校验（D43，通用）：manifest.uniqueField 声明的字段在同 type 实例间全站唯一。
 * 宿主零组件特判（J8）—— 新组件声明 uniqueField 即获得同款校验。
 */
async function uniqueFieldTaken(
  component: string,
  field: string,
  value: string,
  excludeId?: string,
): Promise<boolean> {
  const rows = await api.listDashboards();
  for (const d of rows) {
    let layout: Array<{ id?: string; component?: string; props?: Record<string, unknown> }> = [];
    try {
      layout = JSON.parse(d.layoutJson ?? "[]") as typeof layout;
    } catch {
      /* noop */
    }
    for (const w of layout) {
      if (w.component !== component || w.id === excludeId) continue;
      const props = (w.props ?? {}) as Record<string, unknown>;
      const n = String(props[field] ?? "");
      if (n === value) return true;
    }
  }
  return false;
}

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
}: {
  editMode: boolean;
  canEdit: boolean;
  dirty: boolean;
  /** 启用中的插件 manifest（选择器清单动态合并，J8）。 */
  pluginManifests: WidgetManifest[];
}) {
  const { grid, addWidget } = useGridStack();
  const [pickerOpen, setPickerOpen] = useState(false);

  // ids must be unique across sessions — persisted layouts may already contain
  // t100/n100 from earlier runs; collisions leave the new portal empty (M2-④ 实测).
  // Q80：用 randomId() 而非 crypto.randomUUID() —— 后者**只在安全上下文可用**，
  // HTTP 访问（内网 IP / 未启用 TLS）时是 undefined，添加组件即抛 TypeError。
  const nextId = (prefix: string) => `${prefix}-${randomId().slice(0, 8)}`;

  return (
    <Group mb="sm" gap="xs" style={{ position: "relative", zIndex: 2 }}>
      {editMode && (
        <>
          {(() => {
            // Q29d/三.2：「添加组件」入口移到头部（编辑页面旁）—— Portal 注入头部槽位
            const btn = (
              <Button size="xs" variant="light" onClick={() => setPickerOpen(true)}>
                添加组件
              </Button>
            );
            const slot = typeof document !== "undefined" ? document.getElementById("wb-header-edit-slot") : null;
            return slot ? createPortal(btn, slot) : btn;
          })()}
          <WidgetPicker
            opened={pickerOpen}
            onClose={() => setPickerOpen(false)}
            extraManifests={pluginManifests}
            onAdd={async (manifest, values) => {
              // D43：唯一字段校验（manifest 声明，宿主零组件特判）
              if (manifest.uniqueField) {
                const v = String((values as Record<string, unknown>)[manifest.uniqueField] ?? "").trim();
                if (v && (await uniqueFieldTaken(manifest.type, manifest.uniqueField, v))) {
                  alert(`「${v}」已被同类型组件使用（不允许重名）`);
                  return;
                }
              }
              // SEC3：secret 字段的明文先入凭证库，props 只保存引用
              const props = await propsWithSecretRefs(manifest.configSchema, values, (name, secret) =>
                api.createCredential(name, secret),
              );
              // #5 修复：空画布首个组件落左上角 (0,0)；否则接在现有最低元素下方
              //（原 y:100 硬编码导致空页首组件跑到很下方）
              let y = 0;
              for (const n of grid?.engine.nodes ?? []) {
                y = Math.max(y, (n.y ?? 0) + (n.h ?? 0));
              }
              addWidget({
                id: nextId("w"),
                x: 0,
                y,
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
        <Text size="xs" c="dimmed">
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
  editMode,
  onLayoutSaved,
}: {
  dashboardId: string;
  layoutJson: string;
  canEdit: boolean;
  /** 编辑态（Q22a）：上提到 App —— 入口按钮在头部「插件管理」旁，不再在页面底部。 */
  editMode: boolean;
  onLayoutSaved: (dashboardId: string, layoutJson: string) => void;
}) {
  const gridRef = useRef<GridStackHandle>(null);
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
        { w: 480, c: 1 }, // D39：手机单列全宽（2 列挤压导致标题折行破碎）
      ],
      layout: "moveScale" as const,
    },
    children: parseLayout(layoutJson),
  }));

  // Flush pending layout to server (debounced auto-save, FR-P4).
  // ISS-4 修复：失败按退避（5s→10s→30s 封顶）**真·自动重试**（原文案承诺"稍后自动重试"），
  // 成功或有新变更时取消重试计时器。
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(5_000);
  const flush = useCallback(async () => {
    const json = pendingJson.current;
    if (json === null) return;
    pendingJson.current = null;
    try {
      await api.saveLayout(dashboardId, json);
      setDirty(false);
      setSaveError(null);
      retryDelay.current = 5_000;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      onLayoutSaved(dashboardId, json);
    } catch {
      setSaveError("布局保存失败，稍后自动重试");
      setDirty(true);
      // keep pending + 调度退避重试
      pendingJson.current = json;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void flushRef.current(), retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
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

  // Q22a：编辑态在 App —— true→false 转移时冲刷未保存布局（原 toggle 内联逻辑迁移至此）
  const prevEditRef = useRef(editMode);
  useEffect(() => {
    if (prevEditRef.current && !editMode) void flush();
    prevEditRef.current = editMode;
  }, [editMode, flush]);
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
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
          // D43：唯一字段校验（manifest 声明；exclude 当前实例）
          if (configManifest.uniqueField) {
            const v = String((values as Record<string, unknown>)[configManifest.uniqueField] ?? "").trim();
            if (v && (await uniqueFieldTaken(configManifest.type, configManifest.uniqueField, v, String(configureId ?? "")))) {
              setConfigError(`「${v}」已被同类型组件使用（不允许重名）`);
              return;
            }
          }
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
      {saveError && <WbAlert tone="error">{saveError}</WbAlert>}
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
            refresh={configManifest.capabilities?.refresh}
          />
          {configError && <WbAlert tone="error" size="sm">{configError}</WbAlert>}
        </Modal>
      )}
    </div>
  );
}
