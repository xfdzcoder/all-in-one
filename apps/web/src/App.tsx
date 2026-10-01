import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Button,
  createTheme,
  Center,
  Group,
  Loader,
  MantineProvider,
  Popover,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, ApiError, type Dashboard, type Me } from "./api";
import { Board } from "./Board";
import { ConfirmAction } from "./confirm";
import { WbAlert } from "./ui";
import { LoginPage } from "./LoginPage";
import { DataAdmin } from "./data-admin";
import { PluginAdmin } from "./plugin-admin";
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

function Workbench({ me, onLogout }: { me: Me; onLogout: () => void }) {
  useSseInvalidation();
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [pluginAdminOpen, setPluginAdminOpen] = useState(false);
  // D10/FR-P7: phones & tablets are browse-only — layout editing is desktop-only.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Q22a：布局编辑态上提 —— 入口按钮常驻头部（插件管理旁），不再在页面底部
  const [layoutEdit, setLayoutEdit] = useState(false);
  // FR-D2 / Q25c：数据源管理 = 独立全页视图（大数量好展示；?view=data 深链）
  const [dataTab, setDataTab] = useState<string | undefined>(undefined);
  // Q27d#1：页面切换器弹层
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"workspace" | "data">(() =>
    new URLSearchParams(window.location.search).get("view") === "data" ? "data" : "workspace",
  );
  // 组件 → 数据源管理 的跳转入口（Q26b：邮箱等数据源配置统一在管理页）
  useEffect(() => {
    const onNav = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      setDataTab(tab);
      gotoView("data");
    };
    window.addEventListener("wb:navigate", onNav);
    return () => window.removeEventListener("wb:navigate", onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gotoView = (v: "workspace" | "data") => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "data") url.searchParams.set("view", "data");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url.toString());
  };

  // ISS-1 修复：页面 CRUD 统一错误提示（失败不再静默）
  const [pageError, setPageError] = useState<string | null>(null);

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

  // FR-P1/P9：页面设置（名称/图标/背景色）
  // Q29d/三.3：内联页面设置（失焦即存，无弹窗）
  const savePageSettingsFields = async (patch: { icon?: string | null; background?: string | null; title?: string }) => {
    if (!active) return;
    try {
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
      <AppShell.Header>
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
              <Button
                variant={layoutEdit ? "filled" : "default"}
                size="xs"
                onClick={() => setLayoutEdit((v) => !v)}
              >
                {layoutEdit ? "完成编辑" : "编辑页面"}
              </Button>
            )}
            {/* Q29d/三.2：「添加组件」入口在头部（编辑页面旁）—— Board 经 Portal 注入 */}
            <span id="wb-header-edit-slot" />
            {/* D41：数据源管理属数据操作，移动端开放（布局编辑/插件管理仍桌面专属） */}
            <Button variant="default" size="xs" onClick={() => gotoView("data")}>
              数据源管理
            </Button>
            {isDesktop && (
              <Button variant="default" size="xs" onClick={() => setPluginAdminOpen(true)}>
                插件管理
              </Button>
            )}
            <Button variant="default" size="xs" onClick={() => void api.logout().then(onLogout)}>
              退出登录
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <PluginAdmin opened={pluginAdminOpen} onClose={() => setPluginAdminOpen(false)} />
      {/* FR-P9：页面背景色（留空 = 默认深色底） */}
      <AppShell.Main
        style={{
          background: view === "data" ? "transparent" : active?.background ?? "transparent",
          minHeight: "100vh",
        }}
      >
        {view === "data" && <DataAdmin onBack={() => gotoView("workspace")} initialTab={dataTab} />}
        {view === "workspace" && (
          <>
            {layoutEdit && isDesktop && (
              <div className="wb-pagerow">
                <TextInput
                  size="xs"
                  placeholder="页面名称"
                  defaultValue={active?.title ?? ""}
                  aria-label="页面名称"
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== active?.title) void savePageSettingsWithName(v);
                  }}
                />
                <TextInput
                  size="xs"
                  placeholder="图标（emoji）"
                  defaultValue={active?.icon ?? ""}
                  aria-label="页面图标"
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v !== (active?.icon ?? "")) void savePageSettingsFields({ icon: v.trim() || null });
                  }}
                />
                <TextInput
                  size="xs"
                  placeholder="背景色（如 #102030）"
                  defaultValue={active?.background ?? ""}
                  aria-label="页面背景色"
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v !== (active?.background ?? "")) void savePageSettingsFields({ background: v.trim() || null });
                  }}
                />
              </div>
            )}
            {pageError && (
              <WbAlert tone="error" size="sm" onClose={() => setPageError(null)}>
                {pageError}
              </WbAlert>
            )}
            {active && (
              <Board
                key={active.id}
                dashboardId={active.id}
                layoutJson={active.layoutJson}
                canEdit={isDesktop}
                editMode={layoutEdit}
                onLayoutSaved={handleLayoutSaved}
              />
            )}
          </>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });

  const check = useCallback(async () => {
    try {
      const me = await api.me();
      setSession({ kind: "authed", me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession({ kind: "anonymous" });
      } else {
        setSession({ kind: "anonymous" });
      }
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async fetch-then-set (not synchronous)
    void check();
  }, [check]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mantine 变量桥见 apps/server/src/styles-bridge.ts（经 /custom.css 末尾下发，层叠必胜） */}
      <MantineProvider defaultColorScheme="dark" theme={theme}>
        {session.kind === "loading" && (
          <Center h="50vh">
            <Loader />
          </Center>
        )}
        {session.kind === "anonymous" && <LoginPage onLoggedIn={() => void check()} />}
        {session.kind === "authed" && (
          <Workbench me={session.me} onLogout={() => setSession({ kind: "anonymous" })} />
        )}
      </MantineProvider>
    </QueryClientProvider>
  );
}
