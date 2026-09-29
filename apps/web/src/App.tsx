import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Button,
  Center,
  Group,
  Loader,
  MantineProvider,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { api, ApiError, type Dashboard, type Me } from "./api";
import { Board } from "./Board";
import { LoginPage } from "./LoginPage";

type SessionState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; me: Me };

function Workbench({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
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
    await api.createDashboard(title);
    setNewTitle("");
    await refresh();
  };

  const removeActive = async () => {
    if (!active) return;
    await api.deleteDashboard(active.id);
    setActiveId(null);
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
          <Button variant="default" size="xs" onClick={() => void api.logout().then(onLogout)}>
            退出登录
          </Button>
        </Group>
      </AppShell.Header>
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
            {active && dashboards.length > 1 && (
              <Button size="xs" variant="light" color="red" onClick={() => void removeActive()}>
                删除此页
              </Button>
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
  );
}
