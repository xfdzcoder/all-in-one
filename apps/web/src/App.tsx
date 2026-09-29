import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Button,
  Center,
  Group,
  Loader,
  MantineProvider,
  Modal,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, ApiError, type Dashboard, type Me } from "./api";
import { Board } from "./Board";
import { ConfirmAction } from "./confirm";
import { LoginPage } from "./LoginPage";
import { PluginAdmin } from "./plugin-admin";
import { queryClient, useSseInvalidation } from "./data-hooks";

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  // D10/FR-P7: phones & tablets are browse-only — layout editing is desktop-only.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const refresh = useCallback(async () => {
    const rows = await api.listDashboards();
    setDashboards(rows);
    setActiveId((cur) => cur ?? rows[0]?.id ?? null);
  }, []);

  const handleLayoutSaved = useCallback((dashboardId: string, layoutJson: string) => {
    setDashboards((rows) => rows?.map((r) => (r.id === dashboardId ? { ...r, layoutJson } : r)) ?? rows);
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async fetch-then-set (not synchronous)
    void refresh();
  }, [refresh]);

  const active = dashboards?.find((d) => d.id === activeId) ?? null;

  const addDashboard = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const created = await api.createDashboard(title);
    setNewTitle("");
    await refresh();
    // UX：新建后直接切到新页面（J4 流程也依赖这一点）
    setActiveId(created.id);
  };

  const removeActive = async () => {
    if (!active) return;
    await api.deleteDashboard(active.id);
    setActiveId(null);
    await refresh();
  };

  // FR-P1：页面重命名
  const renameActive = async () => {
    const title = renameTitle.trim();
    if (!active || !title) return;
    await api.patchDashboard(active.id, { title });
    setRenameOpen(false);
    await refresh();
  };

  // FR-P1：页面排序（现状 sortOrder 多为 0 —— 移动后按新序统一编号）
  const moveActive = async (delta: -1 | 1) => {
    if (!active || !dashboards) return;
    const order = [...dashboards];
    const idx = order.findIndex((d) => d.id === active.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= order.length) return;
    order.splice(target, 0, ...order.splice(idx, 1));
    await Promise.all(
      order.map((d, i) => (d.sortOrder !== i ? api.patchDashboard(d.id, { sortOrder: i }) : null)),
    );
    await refresh();
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
            <Text fw={700}>个人工作台</Text>
            <Text size="sm" c="dimmed">
              {me.username}
            </Text>
          </Group>
          <Group gap="xs">
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
      <AppShell.Main>
        <Tabs
          value={activeId}
          onChange={(v) => setActiveId(v)}
          keepMounted={false}
        >
          <Group mb="sm" gap="xs">
            <Tabs.List>
              {dashboards.map((d) => (
                <Tabs.Tab key={d.id} value={d.id}>
                  {d.title}
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
            <Button size="xs" variant="light" onClick={() => void addDashboard()}>
              新建页面
            </Button>
            <Button
              size="xs"
              variant="light"
              disabled={!active}
              onClick={() => {
                setRenameTitle(active?.title ?? "");
                setRenameOpen(true);
              }}
            >
              重命名
            </Button>
            <Button size="xs" variant="light" disabled={!active} onClick={() => void moveActive(-1)}>
              上移
            </Button>
            <Button size="xs" variant="light" disabled={!active} onClick={() => void moveActive(1)}>
              下移
            </Button>
            {active && dashboards.length > 1 && (
              <ConfirmAction
                label="删除此页"
                size="xs"
                message={`删除页面只移除布局与组件排布，业务数据（Todo/看板/邮件/凭证等 Workspace 数据）保留。确认删除页面「${active.title}」？`}
                onConfirm={() => void removeActive()}
              />
            )}
            {renameOpen && (
              <Modal opened onClose={() => setRenameOpen(false)} title="重命名页面" size="sm">
                <TextInput
                  size="xs"
                  label="页面名称"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void renameActive();
                  }}
                />
                <Group gap="xs" mt="sm">
                  <Button size="xs" onClick={() => void renameActive()}>
                    保存
                  </Button>
                  <Button size="xs" variant="default" onClick={() => setRenameOpen(false)}>
                    取消
                  </Button>
                </Group>
              </Modal>
            )}
          </Group>

          {dashboards.map((d) => (
            <Tabs.Panel key={d.id} value={d.id}>
              <Board
                dashboardId={d.id}
                layoutJson={d.layoutJson}
                canEdit={isDesktop}
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
      <MantineProvider>
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
