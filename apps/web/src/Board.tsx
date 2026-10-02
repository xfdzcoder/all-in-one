import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentType } from "react";
import { GridStack, useGridStack } from "gridstack/dist/react";
import type { ComponentMap, GridStackHandle, GridStackWidget } from "gridstack/dist/react";
import { Utils } from "gridstack";
import type { ConfigValues, PluginManifest, WidgetManifest } from "@all-in-one/widget-sdk";
import { Group, Modal, Text } from "@mantine/core";
import { IconPlus } from "./icons";

import { api, DASHBOARD_COLUMNS, type DashboardColumns } from "./api";
import { randomId } from "./random-id";
import { FALLBACK_LAYOUT, manifestForComponent, widgetComponents } from "./widget-registry";
import { WidgetEditContext } from "./widget-edit-context";
import { withWidgetChrome } from "./widget-chrome";
import { WidgetPicker } from "./WidgetPicker";
import { ConfigForm } from "./ConfigForm";
import { PluginFrame } from "./plugin-frame";
import { usePlugins } from "./data-hooks";
import { propsWithSecretRefs } from "./config-form-utils";
import { IconAction, WbAlert } from "./ui";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Q93（项 2）/ **D63**：`uniqueField` 的语义是**数据实体唯一**，不是**展示位置唯一**。
 *
 * 早期实现（D43）把两者混为一谈：宿主扫**全部页面的布局**，只要已有同 type 组件用了同一个
 * 值就拒绝添加 —— 于是「在多个页面放同一个 ToDo」被挡。而 ToDo 的设计本就是**多页面共享
 * 同一份数据**，同一份数据理应在任意页面展示任意多次。
 *
 * 现在：**宿主不再做展示侧唯一性校验**（`uniqueFieldTaken` 已删除）。数据实体名的唯一性
 * 由**数据层**保证（如 todo 分组名在分组表内唯一，已存在则复用），与组件放几个、放哪无关。
 * `WidgetManifest.uniqueField` 保留为**语义声明**（告诉插件作者「这个字段引用的是一个数据
 * 实体」），不再触发拒绝。
 */

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
// WEB-19：值带 manifest 指纹 —— 同 id 重装/换 manifest 不吃旧闭包；随插件清单裁剪防只增不减
const pluginComponentCache = new Map<
  string,
  { comp: ComponentType<Record<string, unknown>>; manifestJson: string }
>();

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

/**
 * Q91（D58）：由列数档位推导响应式断点 `N → N/2 → N/4 → 1`（阈值沿用 D39 的 1200/900/600/480）。
 * 列数档位取 4 的倍数正是为了让取半/取四分之一都是整数。
 */
function breakpointsFor(cols: number): Array<{ w: number; c: number }> {
  const n = Math.max(1, Math.round(Number(cols) || 12));
  const half = Math.max(1, Math.round(n / 2));
  const quarter = Math.max(1, Math.round(n / 4));
  return [
    { w: 1200, c: n },
    { w: 900, c: half },
    { w: 600, c: quarter },
    { w: 480, c: 1 }, // D39：手机单列全宽（2 列挤压导致标题折行破碎）
  ];
}

/** Host UI must live inside <GridStack> (wrapper constraint — useGridStack scope).
 *  Rendered after the grid root in DOM (wrapper design). */
/** 组件 id 生成（纯函数上提模块级；Q80：randomId 代替非安全上下文不可用的 crypto.randomUUID） */
const nextId = (prefix: string) => `${prefix}-${randomId().slice(0, 8)}`;

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

  return (
    <Group mb="sm" gap="xs" style={{ position: "relative", zIndex: 2 }}>
      {editMode && (
        <>
          {(() => {
            // Q29d/三.2：「添加组件」入口移到头部（编辑页面旁）—— Portal 注入头部槽位
            // Q85（项 14）：「添加组件」由文字按钮改 icon；它经 Portal 落在顶栏，
            // 故同批按项 15 用顶栏尺寸（md），卡片内动作簇仍保持默认 sm。
            const btn = (
              <IconAction
                label="添加组件"
                tooltip="添加组件"
                variant="default"
                size="md"
                onClick={() => setPickerOpen(true)}
              >
                <IconPlus size={18} />
              </IconAction>
            );
            const slot = typeof document !== "undefined" ? document.getElementById("wb-header-edit-slot") : null;
            return slot ? createPortal(btn, slot) : btn;
          })()}
          <WidgetPicker
            opened={pickerOpen}
            onClose={() => setPickerOpen(false)}
            extraManifests={pluginManifests}
            onAdd={async (manifest, values) => {
              // Q93（项 2）/ D63：**不再做展示侧唯一性校验** —— 同一份数据可在任意页面放任意多个。
              // 数据实体名的唯一性由数据层保证（见本文件顶部说明）。
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
  columns = 12,
  cellHeight = 80,
  canEdit,
  editMode,
  onLayoutSaved,
}: {
  dashboardId: string;
  layoutJson: string;
  /** Q91（D58）：页面网格列数档位 12/16/20/24/28/32。切列数靠**重挂载**（App 侧 key 含它）。 */
  columns?: DashboardColumns;
  /** Q91（D58）：行高 px。实时改，不重挂载。 */
  cellHeight?: number;
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
  // WEB-19：随当前插件清单裁剪模块级缓存（卸载即释放组件闭包）
  useEffect(() => {
    const alive = new Set(pluginBindings.map((b) => b.id));
    for (const key of pluginComponentCache.keys()) { // Map 迭代中删除当前项是安全的
      if (!alive.has(key)) pluginComponentCache.delete(key);
    }
  }, [pluginBindings]);
  const components = useMemo(() => {
    const map: ComponentMap = { ...chromeComponents };
    for (const b of pluginBindings) {
      // 每插件一个稳定组件实例（模块级缓存）——列表刷新不重挂载沙箱框
      const manifestJson = JSON.stringify(b.manifest);
      let hit = pluginComponentCache.get(b.id);
      if (!hit || hit.manifestJson !== manifestJson) {
        const binding = b;
        hit = {
          comp: withWidgetChrome((props: Record<string, unknown>) => (
            <PluginFrame pluginId={binding.id} manifest={binding.manifest} config={props} />
          )),
          manifestJson,
        };
        pluginComponentCache.set(b.id, hit);
      }
      map[b.manifest.type] = hit.comp;
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

  // Q91（D58）：页面级网格粒度。档位/范围做防呆（服务端 zod 才是权威校验）
  // CON-14：columns 已是档位联合类型，includes 不再需要断言（运行时校验仍留 —— 历史数据/手改 API 可能越档）
  const gridColumns = DASHBOARD_COLUMNS.includes(columns) ? columns : 12;
  const gridCellHeight = Math.min(200, Math.max(40, Math.round(Number(cellHeight) || 80)));

  // Capture layout ONCE per dashboard mount (key={dashboardId-columns-cellHeight} remounts
  // on switch or on grid-granularity change). The grid is the source of truth afterwards —
  // keeping options stable prevents the wrapper's updateOptions() from calling
  // load(children) and resetting unsaved moves.
  const [options] = useState(() => ({
    column: gridColumns,
    cellHeight: gridCellHeight,
    margin: 6,
    mode: "float" as const,
    minRow: 1,
    disableDrag: true,
    disableResize: true,
    columnOpts: {
      // Q91（D58）：断点按 `N → N/2 → N/4 → 1` 推导（阈值沿用既有 1200/900/600/480）
      breakpoints: breakpointsFor(gridColumns),
      // Q93（项 4）：**必须显式给 columnMax** —— gridstack 在 `columnOpts` 启用时把它默认成 12
      // （gridstack.js: `resp.columnMax ?? (resp.columnMax = 12)`），而无断点命中时
      // `checkDynamicColumn` 直接 `newColumn = columnMax` ⇒ 宽屏永远被压回 12 列，
      // 这正是「选了 32 列还是 12 列」的根因（行高不走 columnOpts，所以正常生效）。
      columnMax: gridColumns,
      layout: "moveScale" as const,
    },
    children: parseLayout(layoutJson),
  }));

  // Q91（D58）：行高**实时改**、不重挂载 —— `grid.cellHeight()`，绝不动 options
  // （options 变了会触发 wrapper 的 updateOptions() → load(children)，重置未保存的改动）
  useEffect(() => {
    const g = gridRef.current?.getGrid();
    if (g) g.cellHeight(gridCellHeight);
  }, [gridCellHeight]);

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
      if (disposedRef.current) return; // WEB-17：已卸载 —— 不再 setState/排重试（见卸载清理注释）
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
    // L2-0（Q91）：**显式传列数**存布局。gridstack 默认取 `_layouts[最高列数]`，
    // 显式传 `gridColumns` 让坐标系与 dashboard.columns 严格对齐，不依赖「最高列数」这个隐含约定。
    pendingJson.current = JSON.stringify(grid.save(false, false, undefined, gridColumns));
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    // gridColumns 进依赖以保持闭包正确；实际因 key 含 columns，重挂载前它不会变
  }, [flush, gridColumns]);

  // Cleanup timer on unmount only (NOT on flush identity change — that would
  // prematurely flush mid-debounce after every parent re-render).
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush; // oxlint-disable-line react/immutability -- latest-ref 惯用法（React 官方模式），ref.current 赋值即其用法
  });

  // Q22a：编辑态在 App —— true→false 转移时冲刷未保存布局（原 toggle 内联逻辑迁移至此）
  const prevEditRef = useRef(editMode);
  useEffect(() => {
    if (prevEditRef.current && !editMode) void flush();
    prevEditRef.current = editMode;
  }, [editMode, flush]);
  // WEB-17：卸载后不再 setState/无限退避（原 cleanup 清计时器后 flush 失败会再建 retryTimer —— 幽灵重试）
  const disposedRef = useRef(false);
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      void flushRef.current().catch(() => {
        console.error("[board] 卸载时布局保存失败，改动未能落盘（已尽力保存，不再重试）");
      });
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
      setConfigValues({ ...node.props });
      setConfigOriginal({ ...node.props });
      setConfigError(null);
    },
    [manifestFor],
  );

  // WEB-18：提交 in-flight 守卫 —— 双击曾重复建凭证/重复更新（propsWithSecretRefs 每次新建 credential）
  const savingRef = useRef(false);
  const saveConfig = useCallback(
    (values: ConfigValues) => {
      void (async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          const grid = gridRef.current?.getGrid();
          const node = grid && configureId ? findNode(grid, configureId) : undefined;
          if (!grid || !node?.el || !configManifest) return;
          // Q93（项 2）/ D63：同上 —— 不做展示侧唯一性校验
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
        } finally {
          savingRef.current = false;
        }
      })();
    },
    [configureId, configManifest, configOriginal, scheduleSave],
  );

  const editCtxValue = useMemo(
    () => ({ editMode: effectiveEditMode, onConfigure: openConfig, requestSave: scheduleSave }),
    [effectiveEditMode, openConfig, scheduleSave],
  );

  return (
    <div>
      {saveError && <WbAlert tone="error">{saveError}</WbAlert>}
      <WidgetEditContext.Provider
        value={editCtxValue} // jsx-no-constructed-context-values：useMemo 稳定引用
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
