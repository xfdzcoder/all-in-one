import { Button, Group, SegmentedControl, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import {
  IconDatabase,
  IconInfoCircle,
  IconLogout,
  IconPalette,
  IconPuzzle,
  IconUser,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import type { Me } from "./api";
import { DataAdmin } from "./data-admin";
import { PluginAdmin } from "./plugin-admin";
import { WbAlert } from "./ui";

/**
 * 设置页（用户指令 2026-10-02：头部「数据源管理 / 插件管理 / 主题切换 / 退出登录」
 * 四按钮整合为一个「设置」）。左右分栏：左菜单（账户 / 外观 / 插件 / 数据源 / 关于）
 * + 右主区域。全页视图（沿用 DataAdmin 的 `?view=` 深链范式），移动端只浏览操作
 * （D10：插件管理桌面专属）。
 */
export type SettingsTab = "account" | "appearance" | "plugins" | "data" | "about";

const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string; icon: ReactNode }> = [
  { key: "account", label: "账户", icon: <IconUser size={16} /> },
  { key: "appearance", label: "外观", icon: <IconPalette size={16} /> },
  { key: "plugins", label: "插件", icon: <IconPuzzle size={16} /> },
  { key: "data", label: "数据源", icon: <IconDatabase size={16} /> },
  { key: "about", label: "关于", icon: <IconInfoCircle size={16} /> },
];

export function isSettingsTab(v: string | null): v is SettingsTab {
  return SETTINGS_TABS.some((t) => t.key === v);
}

export function SettingsAdmin(props: {
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onBack: () => void;
  me: Me;
  themeMode: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
  /** D10：布局/插件管理桌面专属；移动端隐藏「插件」菜单。 */
  isDesktop: boolean;
  /** 数据源管理的页签深链（wb:navigate 跳转带过来）。 */
  dataTab: string | undefined;
}) {
  const { tab, onTab, onBack, me, themeMode, onToggleTheme, onLogout, isDesktop, dataTab } = props;
  const items = SETTINGS_TABS.filter((t) => t.key !== "plugins" || isDesktop);

  return (
    <div className="wb-settings">
      <div className="wb-admin__bar">
        <Button variant="default" size="xs" onClick={onBack}>
          ← 返回工作台
        </Button>
        <Title order={4} className="wb-admin__title">
          设置
        </Title>
      </div>
      <div className="wb-settings__body">
        <nav className="wb-settings__nav" aria-label="设置菜单">
          {items.map((t) => (
            <UnstyledButton
              key={t.key}
              className={`wb-settings__item${tab === t.key ? " wb-settings__item--active" : ""}`}
              aria-current={tab === t.key ? "page" : undefined}
              onClick={() => onTab(t.key)}
            >
              <span className="wb-settings__item-icon" aria-hidden>
                {t.icon}
              </span>
              {t.label}
            </UnstyledButton>
          ))}
        </nav>
        <div className="wb-settings__panel">
          {tab === "account" && (
            <Stack gap="md" className="wb-settings__section">
              <Title order={5}>账户</Title>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  用户名
                </Text>
                <Text size="sm" fw={600}>
                  {me.username}
                </Text>
              </Group>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconLogout size={14} />}
                  onClick={onLogout}
                >
                  退出登录
                </Button>
              </Group>
              <WbAlert tone="info" size="sm">
                忘记口令？管理员口令在部署时由 <code>ADMIN_PASSWORD</code> 设置 ——
                在服务器上修改该环境变量并重启服务即可重置。
              </WbAlert>
            </Stack>
          )}
          {tab === "appearance" && (
            <Stack gap="md" className="wb-settings__section">
              <Title order={5}>外观</Title>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  主题
                </Text>
                <SegmentedControl
                  size="xs"
                  value={themeMode}
                  onChange={(v) => {
                    // SegmentedControl 单选语义：只有真的切换才触发（避免重复 set）
                    if ((v === "dark") !== (themeMode === "dark")) onToggleTheme();
                  }}
                  data={[
                    { label: "深色", value: "dark" },
                    { label: "浅色", value: "light" },
                  ]}
                />
              </Group>
            </Stack>
          )}
          {tab === "plugins" && (
            <Stack gap="md" className="wb-settings__section">
              <Title order={5}>插件管理</Title>
              <PluginAdmin />
            </Stack>
          )}
          {tab === "data" && (
            <DataPanel dataTab={dataTab} />
          )}
          {tab === "about" && (
            <Stack gap="md" className="wb-settings__section">
              <Title order={5}>关于</Title>
              <Text size="sm">
                个人工作台（all-in-one）——自托管的一站式个人仪表盘：把待办、订阅、看板、
                邮件与自建服务（照片/音乐/容器/代理）汇总到一页，全部数据留在自己的服务器上。
              </Text>
              <Text size="sm" c="dimmed">
                技术栈：React + Vite + Mantine（前端）、Fastify + SQLite（服务端）、
                gridstack（布局）；组件按 Manifest 契约扩展，支持零代码组件（iframe / 自定义 API）
                与代码级插件（沙箱隔离）。
              </Text>
              <Text size="sm" c="dimmed">
                样式与令牌覆盖指南见 <code>docs/design-audit/02-custom-css.md</code>；
                部署与环境变量见 <code>docs/deploy.md</code>。
              </Text>
            </Stack>
          )}
        </div>
      </div>
    </div>
  );
}

/** 数据源面板：整体复用数据源管理页（7 页签原样，Q25c 全页形态）。 */
function DataPanel({ dataTab }: { dataTab: string | undefined }) {
  return (
    <div className="wb-settings__data">
      <DataAdmin embedded initialTab={dataTab} />
    </div>
  );
}
