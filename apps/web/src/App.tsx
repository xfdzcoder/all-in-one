import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Button,
  createTheme,
  Center,
  Group,
  Loader,
  MantineProvider,
  Modal,
  Stack,
  Tabs,
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

/** Q19b：主题令牌（theme 字段在同一规则内无竞争，值全部引用 --wb-* 令牌）。 */
const theme = createTheme({
  primaryColor: "blue",
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState("");
  const [settingsIcon, setSettingsIcon] = useState("");
  const [settingsBackground, setSettingsBackground] = useState("");
  // D10/FR-P7: phones & tablets are browse-only — layout editing is desktop-only.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Q22a：布局编辑态上提 —— 入口按钮常驻头部（插件管理旁），不再在页面底部
  const [layoutEdit, setLayoutEdit] = useState(false);
  // FR-D2 / Q25c：数据源管理 = 独立全页视图（大数量好展示；?view=data 深链）
  const [dataTab, setDataTab] = useState<string | undefined>(undefined);
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
  const savePageSettings = async () => {
    const title = settingsTitle.trim();
    if (!active || !title) return;
    try {
      await api.patchDashboard(active.id, {
        title,
        icon: settingsIcon.trim() || null,
        background: settingsBackground.trim() || null,
      });
      setSettingsOpen(false);
      setPageError(null);
      await refresh();
    } catch (e) {
      setPageError(`保存页面设置失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
            {isDesktop && view === "workspace" && (
              // Q27b#4：数据源管理页不显示布局编辑入口
              <Button
                variant={layoutEdit ? "filled" : "default"}
                size="xs"
                onClick={() => setLayoutEdit((v) => !v)}
              >
                {layoutEdit ? "完成编辑" : "编辑布局"}
              </Button>
            )}
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
        <Tabs
          value={activeId}
          onChange={(v) => {
            setActiveId(v);
            // ISS-3：活动页进 URL（replaceState 不产生历史项）
            if (v) window.history.replaceState(null, "", `?page=${v}`);
          }}
          keepMounted={false}
        >
          {pageError && (
            <WbAlert tone="error" size="sm" onClose={() => setPageError(null)}>
              {pageError}
            </WbAlert>
          )}
          <Group mb="sm" gap="xs" wrap="nowrap">
            <Tabs.List className="wb-tabs">
              {dashboards.map((d) => (
                <Tabs.Tab key={d.id} value={d.id}>
                  {d.icon ? `${d.icon} ${d.title}` : d.title}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <TextInput
              size="xs"
              placeholder="新页面名"
              value={newTitle}
              onChange={(e) => setNewTitle(e.currentTarget.value)}
              style={{ width: 140 }}
            />
            <Button size="xs" disabled={!newTitle.trim()} onClick={() => void addDashboard()}>
              新建页面
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={!active}
              onClick={() => {
                setSettingsTitle(active?.title ?? "");
                setSettingsIcon(active?.icon ?? "");
                setSettingsBackground(active?.background ?? "");
                setSettingsOpen(true);
              }}
            >
              页面设置
            </Button>
            <Button size="xs" variant="default" disabled={!active || activeIndex <= 0} onClick={() => void moveActive(-1)}>
              上移
            </Button>
            <Button size="xs" variant="default" disabled={!active || activeIndex >= (dashboards?.length ?? 0) - 1} onClick={() => void moveActive(1)}>
              下移
            </Button>
            {active && dashboards.length > 1 && (
              <ConfirmAction
                label="删除此页"
                size="xs"
                variant="subtle"
                title="删除页面？"
                message={`删除页面只移除布局与组件排布，业务数据（Todo/看板/邮件/凭证等 Workspace 数据）保留。确认删除页面「${active.title}」？`}
                onConfirm={() => void removeActive()}
              />
            )}
            {settingsOpen && (
              <Modal opened onClose={() => setSettingsOpen(false)} title="页面设置" size="sm">
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    label="页面名称"
                    value={settingsTitle}
                    onChange={(e) => setSettingsTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void savePageSettings();
                    }}
                  />
                  <TextInput
                    size="xs"
                    label="图标（emoji / 短文本）"
                    value={settingsIcon}
                    onChange={(e) => setSettingsIcon(e.currentTarget.value)}
                    placeholder="如 🧪（留空 = 无图标）"
                  />
                  <TextInput
                    size="xs"
                    label="背景色"
                    value={settingsBackground}
                    onChange={(e) => setSettingsBackground(e.currentTarget.value)}
                    placeholder="如 #102030（留空 = 默认底色）"
                  />
                  <Group gap="xs">
                    <Button size="xs" disabled={!settingsTitle.trim()} onClick={() => void savePageSettings()}>
                      保存
                    </Button>
                    <Button size="xs" variant="default" onClick={() => setSettingsOpen(false)}>
                      取消
                    </Button>
                  </Group>
                </Stack>
              </Modal>
            )}
          </Group>

          {dashboards.map((d) => (
            <Tabs.Panel key={d.id} value={d.id}>
              <Board
                dashboardId={d.id}
                layoutJson={d.layoutJson}
                canEdit={isDesktop}
                editMode={layoutEdit}
                onLayoutSaved={handleLayoutSaved}
              />
            </Tabs.Panel>
          ))}

          {dashboards.length === 0 && (
            <Center h="30vh">
              <Text c="dimmed">还没有页面，输入名称创建一个</Text>
            </Center>
          )}
        </Tabs>
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
