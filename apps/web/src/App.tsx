import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Button,
  createTheme,
  Center,
  Group,
  Loader,
  MantineProvider,
  NumberInput,
  Popover,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { IconCheck, IconPencil, IconSettings } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, DASHBOARD_COLUMNS, type Dashboard, type DashboardColumns, type Me } from "./api";
import { rescaleLayout } from "./grid-rescale";
import { Board } from "./Board";
import { ConfirmAction } from "./confirm";
import { IconAction, WbAlert } from "./ui";
import { reportError } from "./feedback";
import { LoginPage } from "./LoginPage";
import { WidgetErrorBoundary } from "./error-boundary";
import { SettingsAdmin, isSettingsTab, type SettingsTab } from "./settings-admin";
import { queryClient, useSseInvalidation } from "./data-hooks";

/** Q19b：主题令牌（theme 字段在同一规则内无竞争，值全部引用 --wb-* 令牌）。
 *  D52 批1：蓝色阶对齐 --wb-color-accent 家族（Mantine 组件与令牌同源）。 */
const theme = createTheme({
  primaryColor: "blue",
  colors: {
    blue: [
      "#e9eeff",
      "#cad7ff",
      "#a4bbff",
      "#7d9aff",
      "#5b86ff",
      "#4f7dff",
      "#3f63e8",
      "#3450c2",
      "#2a3f96",
      "#21316f",
    ],
  },
  fontFamily: "var(--wb-font-sans)",
  defaultRadius: "sm",
  radius: {
    xs: "calc(var(--wb-radius-sm) / 2)",
    sm: "var(--wb-radius-sm)",
    md: "var(--wb-radius-md)",
    lg: "var(--wb-radius-lg)",
  },
});

type SessionState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; me: Me };

/** URL 查询参数快照（深链初始化用；后续同步走 gotoView 写回）。 */
const queryOf = () => new URLSearchParams(window.location.search);

/** Q63（D52 双主题）：主题模式 —— 深色默认，[data-theme=light] 切浅色（localStorage 持久化）。 */
type ThemeMode = "dark" | "light";
const initialThemeMode = (): ThemeMode => {
  try {
    return localStorage.getItem("wb-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

function Workbench({
  me,
  onLogout,
  onProfileChanged,
  themeMode,
  onToggleTheme,
}: {
  me: Me;
  onLogout: () => void;
  /** FR-S2：改用户名后刷新会话（头部 `me.username` 跟着变）。 */
  onProfileChanged: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}) {
  useSseInvalidation();
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  // D10/FR-P7: phones & tablets are browse-only — layout editing is desktop-only.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Q22a：布局编辑态上提 —— 入口按钮常驻头部，不再在页面底部
  const [layoutEdit, setLayoutEdit] = useState(false);
  // 数据源管理已并入设置页「数据源」（B1）；?dataTab= 组件内跳转的目标页签（wb:navigate）
  const [dataTab, setDataTab] = useState<string | undefined>(undefined);
  // Q27d#1：页面切换器弹层
  const [menuOpen, setMenuOpen] = useState(false);
  // B1（用户指令）：头部「数据源管理/插件管理/主题切换/退出登录」四按钮 → 单个「设置」。
  // 深链：?view=settings&tab=<账户|外观|插件|数据源|关于>；旧 ?view=data 视为 settings+数据源。
  const [view, setView] = useState<"workspace" | "settings">(() => {
    const v = queryOf().get("view");
    return v === "settings" || v === "data" ? "settings" : "workspace";
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => {
    const q = queryOf();
    const tab = q.get("tab");
    if (isSettingsTab(tab)) return tab;
    return q.get("view") === "data" ? "data" : "account";
  });
  // 组件 → 数据源管理 的跳转入口（Q26b：邮箱等数据源配置统一在管理页）；B1 起落在设置页「数据源」
  useEffect(() => {
    const onNav = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      setDataTab(tab);
      gotoView("settings", "data");
    };
    window.addEventListener("wb:navigate", onNav);
    return () => window.removeEventListener("wb:navigate", onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gotoView = (v: "workspace" | "settings", tab?: SettingsTab) => {
    setView(v);
    const next = tab ?? settingsTab;
    if (tab) setSettingsTab(tab);
    const url = new URL(window.location.href);
    if (v === "settings") {
      url.searchParams.set("view", "settings");
      url.searchParams.set("tab", next);
    } else {
      url.searchParams.delete("view");
      url.searchParams.delete("tab");
    }
    window.history.replaceState(null, "", url.toString());
  };

  // 退出登录（B1 起入口在设置页 · 账户）：清会话 + 清客户端缓存
  const handleLogout = useCallback(() => {
    void api
      .logout()
      .then(() => {
        // WEB-14：清客户端缓存 —— 上一会话的任务/邮件/**缩略图 base64** 不残留内存（换用户场景直接可见旧数据）
        queryClient.clear();
        onLogout();
        return true; // promise(always-return)：链式语义明确
      })
      .catch((e) => reportError("退出登录失败", e)); // WEB-4
  }, [onLogout]);

  // ISS-1 修复：页面 CRUD 统一错误提示（失败不再静默）
  const [pageError, setPageError] = useState<string | null>(null);
  // WEB-4/WEB-6（Q99d）：异步失败反馈通道 —— reportError() 派发 `wb:error`，这里统一可见
  const [asyncError, setAsyncError] = useState<string | null>(null);
  useEffect(() => {
    const onErr = (e: Event) => setAsyncError(String((e as CustomEvent<string>).detail ?? "操作失败"));
    window.addEventListener("wb:error", onErr);
    return () => window.removeEventListener("wb:error", onErr);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.listDashboards();
      setDashboards(rows);
      // ISS-3 修复：活动页持久化 —— 深链 ?page=<id> 优先，刷新停留在原页
      const fromQuery = new URLSearchParams(window.location.search).get("page");
      setActiveId(
        (cur) => cur ?? (rows.some((r) => r.id === fromQuery) ? (fromQuery as string) : (rows[0]?.id ?? null)),
      );
      setPageError(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleLayoutSaved = useCallback((dashboardId: string, layoutJson: string) => {
    setDashboards((rows) => rows?.map((r) => (r.id === dashboardId ? { ...r, layoutJson } : r)) ?? rows);
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async fetch-then-set (not synchronous)
    void refresh();
  }, [refresh]);

  const active = dashboards?.find((d) => d.id === activeId) ?? null;
  // ISS-5：首/末页边界禁用上移/下移（不再静默无效）
  const activeIndex = dashboards ? dashboards.findIndex((d) => d.id === activeId) : -1;

  const addDashboard = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const created = await api.createDashboard(title);
      setNewTitle("");
      setPageError(null);
      await refresh();
      // UX：新建后直接切到新页面（J4 流程也依赖这一点）
      setActiveId(created.id);
    } catch (e) {
      setPageError(`新建页面失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeActive = async () => {
    if (!active) return;
    try {
      await api.deleteDashboard(active.id);
      setActiveId(null);
      setPageError(null);
      await refresh();
    } catch (e) {
      setPageError(`删除页面失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // FR-P1/P9：页面设置（名称/图标/背景色 + Q91 网格粒度）
  // Q29d/三.3：内联页面设置（失焦即存，无弹窗）
  const savePageSettingsFields = async (patch: {
    icon?: string | null;
    background?: string | null;
    title?: string;
    columns?: DashboardColumns;
    cellHeight?: number;
  }) => {
    if (!active) return;
    try {
      // Q91（D58）：切列数 = **坐标系变化**，必须按比例重算 x/w 再落盘，否则组件占错位置。
      // （先存布局再存设置，保证任何一步失败都不会出现「列数已改、坐标没改」的中间态被刷新读到）
      if (patch.columns !== undefined && patch.columns !== active.columns) {
        let widgets: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
        try {
          const parsed: unknown = JSON.parse(active.layoutJson);
          if (Array.isArray(parsed)) widgets = parsed as typeof widgets;
        } catch {
          widgets = [];
        }
        await api.saveLayout(active.id, JSON.stringify(rescaleLayout(widgets, active.columns, patch.columns)));
      }
      await api.patchDashboard(active.id, patch);
      setPageError(null);
      await refresh();
    } catch (e) {
      setPageError(`保存页面设置失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const savePageSettingsWithName = (title: string) => savePageSettingsFields({ title });


  // FR-P1：页面排序（现状 sortOrder 多为 0 —— 移动后按新序统一编号）
  const moveActive = async (delta: -1 | 1) => {
    if (!active || !dashboards) return;
    const order = [...dashboards];
    const idx = order.findIndex((d) => d.id === active.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= order.length) return;
    order.splice(target, 0, ...order.splice(idx, 1));
    try {
      await Promise.all(
        order.map((d, i) => (d.sortOrder !== i ? api.patchDashboard(d.id, { sortOrder: i }) : null)),
      );
      setPageError(null);
      await refresh();
    } catch (e) {
      setPageError(`页面排序失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!dashboards) {
    return (
      <Center h="50vh">
        <Loader />
      </Center>
    );
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header className="wb-header">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="md">
            <Group gap={6}>
              <img src="/favicon.svg" alt="" width={18} height={18} />
              <Text fw={700}>个人工作台</Text>
            </Group>
            <Text size="sm" c="dimmed">
              {me.username}
            </Text>
          </Group>
          <Group gap="xs">
            {/* Q27d#1：页面切换 = 右上角弹出下拉（页面管理一并收纳） */}
            {view === "workspace" && (
              <Popover opened={menuOpen} onChange={setMenuOpen} width={280} shadow="md" position="bottom-end">
                <Popover.Target>
                  <Button variant="default" size="xs" aria-label="切换页面" onClick={() => setMenuOpen((o) => !o)}>
                    {active?.icon ? `${active.icon} ` : ""}
                    {active?.title ?? "页面"} ▾
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <div className="wb-pagelist">
                    {dashboards.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        data-page-item={d.title}
                        className={`wb-pageitem${d.id === activeId ? " wb-pageitem--active" : ""}`}
                        onClick={() => {
                          setActiveId(d.id);
                          setMenuOpen(false);
                          window.history.replaceState(null, "", `?page=${d.id}`);
                        }}
                      >
                        {d.icon ? `${d.icon} ` : ""}
                        {d.title}
                      </button>
                    ))}
                  </div>
                  <div className="wb-pagemenu">
                    <TextInput
                      size="xs"
                      placeholder="新页面名"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.currentTarget.value)}
                    />
                    <Button size="xs" disabled={!newTitle.trim()} onClick={() => void addDashboard()}>
                      新建页面
                    </Button>
                    <Button size="xs" variant="default" disabled={!active || activeIndex <= 0} onClick={() => void moveActive(-1)}>
                      上移
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      disabled={!active || activeIndex >= (dashboards?.length ?? 0) - 1}
                      onClick={() => void moveActive(1)}
                    >
                      下移
                    </Button>
                    {active && dashboards.length > 1 && (
                      <ConfirmAction
                        label="删除此页"
                        size="xs"
                        variant="subtle"
                        title="删除页面？"
                        message={`删除页面只移除布局与组件排布，业务数据（任务/看板/邮件/凭证等 Workspace 数据）保留 —— 可在「数据源管理」查看或删除。确认删除页面「${active.title}」？`}
                        onConfirm={() => void removeActive()}
                      />
                    )}
                  </div>
                </Popover.Dropdown>
              </Popover>
            )}
            {isDesktop && view === "workspace" && (
              // Q27b#4：数据源管理页不显示布局编辑入口；Q29d/三.3：编辑布局 → 编辑页面
              // 项 7（D52/Q65 icon 化）：标签保留「编辑页面」↔「完成编辑」——
              // IconAction 的 wb-sr-only 文本让 verify-* 的 textContent 选择器零迁移。
              <IconAction
                label={layoutEdit ? "完成编辑" : "编辑页面"}
                tooltip={layoutEdit ? "完成编辑" : "编辑页面"}
                variant={layoutEdit ? "filled" : "default"}
                size="md"
                onClick={() => setLayoutEdit((v) => !v)}
              >
                {layoutEdit ? <IconCheck size={18} /> : <IconPencil size={18} />}
              </IconAction>
            )}
            {/* Q29d/三.2：「添加组件」入口在头部（编辑页面旁）—— Board 经 Portal 注入 */}
            <span id="wb-header-edit-slot" />
            {/* B1（用户指令）：数据源管理 / 插件管理 / 主题切换 / 退出登录 四按钮 → 单个「设置」。
                移动端同样开放入口（设置内「插件」菜单按 D10 桌面专属隐藏）。 */}
            <IconAction
              label="设置"
              tooltip="设置"
              variant={view === "settings" ? "filled" : "default"}
              size="md"
              onClick={() => gotoView("settings", settingsTab)}
            >
              <IconSettings size={18} />
            </IconAction>
          </Group>
        </Group>
      </AppShell.Header>
      {/* FR-P9：页面背景色（留空 = 默认深色底） */}
      <AppShell.Main
        className="wb-main"
        style={{
          background: view === "workspace" ? active?.background ?? "transparent" : "transparent",
        }}
      >
        {view === "settings" && (
          <WidgetErrorBoundary name="设置">
            <SettingsAdmin
              tab={settingsTab}
              onTab={(t) => gotoView("settings", t)}
              onBack={() => gotoView("workspace")}
              me={me}
              themeMode={themeMode}
              onToggleTheme={onToggleTheme}
              onLogout={handleLogout}
              isDesktop={isDesktop}
              dataTab={dataTab}
              onProfileChanged={onProfileChanged}
            />
          </WidgetErrorBoundary>
        )}
        {view === "workspace" && (
          <>
            {layoutEdit && isDesktop && (
              <div className="wb-pagerow">
                <TextInput
                  size="xs"
                  label="页面名称"
                  placeholder="如：首页"
                  defaultValue={active?.title ?? ""}
                  aria-label="页面名称"
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== active?.title) void savePageSettingsWithName(v);
                  }}
                />
                <TextInput
                  size="xs"
                  label="页面图标"
                  placeholder="emoji，如 🏠"
                  defaultValue={active?.icon ?? ""}
                  aria-label="页面图标"
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v !== (active?.icon ?? "")) void savePageSettingsFields({ icon: v.trim() || null });
                  }}
                />
                <TextInput
                  size="xs"
                  label="背景色"
                  placeholder="如 #102030，留空＝默认"
                  defaultValue={active?.background ?? ""}
                  aria-label="页面背景色"
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v !== (active?.background ?? "")) void savePageSettingsFields({ background: v.trim() || null });
                  }}
                />
                {/* Q91（D58）：页面级网格粒度 —— 列数 / 行高 */}
                <Select
                  size="xs"
                  label="网格列数"
                  aria-label="网格列数"
                  data={DASHBOARD_COLUMNS.map((c) => ({ value: String(c), label: `${c} 列` }))}
                  value={String(active?.columns ?? 12)}
                  onChange={(v) => {
                    // CON-14：档位收窄零断言（Select 只出 DASHBOARD_COLUMNS 值）
                    const n = DASHBOARD_COLUMNS.find((c) => String(c) === v);
                    if (n !== undefined && n !== active?.columns) void savePageSettingsFields({ columns: n });
                  }}
                />
                <NumberInput
                  size="xs"
                  label="网格行高（px）"
                  aria-label="网格行高"
                  min={40}
                  max={200}
                  step={10}
                  defaultValue={active?.cellHeight ?? 80}
                  onBlur={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n) && n !== active?.cellHeight) {
                      void savePageSettingsFields({ cellHeight: Math.min(200, Math.max(40, Math.round(n))) });
                    }
                  }}
                />
              </div>
            )}
            {pageError && (
              <WbAlert tone="error" size="sm" onClose={() => setPageError(null)}>
                {pageError}
              </WbAlert>
            )}
            {asyncError && (
              <WbAlert tone="error" size="sm" onClose={() => setAsyncError(null)}>
                {asyncError}
              </WbAlert>
            )}
            {active && (
              <WidgetErrorBoundary name="看板">
                <Board
                  key={`${active.id}-${active.columns}`}
                  dashboardId={active.id}
                  layoutJson={active.layoutJson}
                  columns={active.columns}
                  cellHeight={active.cellHeight}
                  canEdit={isDesktop}
                  editMode={layoutEdit}
                  onLayoutSaved={handleLayoutSaved}
                />
              </WidgetErrorBoundary>
            )}
          </>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);

  // Q63：data-theme 同步到 <html>（tokens.css 浅色变量组的挂载点）+ 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      localStorage.setItem("wb-theme", themeMode);
    } catch {
      /* 私隐模式等场景忽略 */
    }
  }, [themeMode]);

  const check = useCallback(async () => {
    try {
      const me = await api.me();
      setSession({ kind: "authed", me });
    } catch {
      // WEB-13：401 与其它错误同样回登录页（原 if/else 两分支完全相同，是死分支）
      setSession({ kind: "anonymous" });
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async fetch-then-set (not synchronous)
    void check();
  }, [check]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mantine 变量桥见 apps/server/src/styles-bridge.ts（经 /custom.css 末尾下发，层叠必胜） */}
      <MantineProvider defaultColorScheme="dark" forceColorScheme={themeMode} theme={theme}>
        {/* WEB-7：根边界兜底（其内各视图另有自己的边界，根边界防「边界之外」的渲染崩溃白屏） */}
        <WidgetErrorBoundary name="应用">
        {session.kind === "loading" && (
          <Center h="50vh">
            <Loader />
          </Center>
        )}
        {session.kind === "anonymous" && <LoginPage onLoggedIn={() => void check()} />}
        {session.kind === "authed" && (
          <Workbench
            me={session.me}
            onLogout={() => setSession({ kind: "anonymous" })}
            onProfileChanged={() => void check()}
            themeMode={themeMode}
            onToggleTheme={() => setThemeMode((m) => (m === "dark" ? "light" : "dark"))}
          />
        )}
        </WidgetErrorBoundary>
      </MantineProvider>
    </QueryClientProvider>
  );
}
