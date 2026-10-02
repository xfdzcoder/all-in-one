import { Button, Group, PasswordInput, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import {
  IconDatabase,
  IconInfoCircle,
  IconLogout,
  IconPalette,
  IconPuzzle,
  IconUser,
} from "./icons";
import { useState, type ReactNode } from "react";

import { api, type Me } from "./api";
import { AppearancePanel } from "./appearance-panel";
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
  me: Me;
  themeMode: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
  /** D10：布局/插件管理桌面专属；移动端隐藏「插件」菜单。 */
  isDesktop: boolean;
  /** 数据源管理的页签深链（wb:navigate 跳转带过来）。 */
  dataTab: string | undefined;
  /** 改用户名后刷新会话（头部 `me.username` 跟着变）。 */
  onProfileChanged: () => void;
  /** Q120：页面切换「到头循环」开关（设置·外观持久化）。 */
  pageWrap: boolean;
  onTogglePageWrap: () => void;
}) {
  const { tab, onTab, me, themeMode, onToggleTheme, onLogout, isDesktop, dataTab, onProfileChanged, pageWrap, onTogglePageWrap } = props;
  const items = SETTINGS_TABS.filter((t) => t.key !== "plugins" || isDesktop);

  return (
    <div className="wb-settings">
      {/* Q118：返回入口移至左上角标题（aria-label="返回工作台"），此处不再放返回按钮 */}
      <div className="wb-admin__bar">
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
            <AccountPanel me={me} onProfileChanged={onProfileChanged} onLogout={onLogout} />
          )}
          {tab === "appearance" && (
            <AppearancePanel themeMode={themeMode} onToggleTheme={onToggleTheme} pageWrap={pageWrap} onTogglePageWrap={onTogglePageWrap} />
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
      <DataAdmin initialTab={dataTab} />
    </div>
  );
}

/** 账户面板（FR-S2/Q110）：改用户名 / 改密码（都**验证当前密码**）+ 退出登录。 */
function AccountPanel({
  me,
  onProfileChanged,
  onLogout,
}: {
  me: Me;
  onProfileChanged: () => void;
  onLogout: () => void;
}) {
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [username, setUsername] = useState(me.username);
  const [namePw, setNamePw] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const saveUsername = async () => {
    if (nameBusy) return; // WEB-18：in-flight 守卫（双击重复提交）
    if (username.trim() === me.username) {
      setMsg({ tone: "error", text: "用户名没有变化" });
      return;
    }
    if (!namePw) {
      setMsg({ tone: "error", text: "修改用户名需要验证当前密码" });
      return;
    }
    setNameBusy(true);
    try {
      await api.changeUsername(namePw, username.trim());
      setMsg({ tone: "success", text: "用户名已更新" });
      setNamePw("");
      onProfileChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setNameBusy(false);
    }
  };

  const savePassword = async () => {
    if (pwBusy) return;
    if (!pwCurrent) {
      setMsg({ tone: "error", text: "修改密码需要验证当前密码" });
      return;
    }
    if (pwNew !== pwNew2) {
      setMsg({ tone: "error", text: "两次输入的新口令不一致" });
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(pwCurrent, pwNew);
      setMsg({ tone: "success", text: "密码已更新；其它设备上的登录已失效" });
      setPwCurrent("");
      setPwNew("");
      setPwNew2("");
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <Stack gap="md" className="wb-settings__section">
      <Title order={5}>账户</Title>
      {msg && (
        <WbAlert tone={msg.tone} size="sm" onClose={() => setMsg(null)}>
          {msg.text}
        </WbAlert>
      )}
      <Stack gap="xs" className="wb-settings__form">
        <Text size="sm" c="dimmed">
          用户名
        </Text>
        <Group gap="xs" align="flex-end" wrap="wrap">
          <TextInput
            size="xs"
            label="新用户名"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            className="wb-flex-1"
          />
          <PasswordInput
            size="xs"
            label="当前密码"
            value={namePw}
            onChange={(e) => setNamePw(e.currentTarget.value)}
            className="wb-flex-1"
          />
          <Button size="xs" disabled={nameBusy} onClick={() => void saveUsername()}>
            保存用户名
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          当前：<b>{me.username}</b>（修改需要验证当前密码）
        </Text>
      </Stack>
      <Stack gap="xs" className="wb-settings__form">
        <Text size="sm" c="dimmed">
          密码
        </Text>
        <Group gap="xs" align="flex-end" wrap="wrap">
          <PasswordInput
            size="xs"
            label="当前密码"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.currentTarget.value)}
            className="wb-flex-1"
          />
          <PasswordInput
            size="xs"
            label="新密码（建议至少 8 位）"
            value={pwNew}
            onChange={(e) => setPwNew(e.currentTarget.value)}
            className="wb-flex-1"
          />
          <PasswordInput
            size="xs"
            label="再输一次新密码"
            value={pwNew2}
            onChange={(e) => setPwNew2(e.currentTarget.value)}
            className="wb-flex-1"
          />
          <Button size="xs" disabled={pwBusy} onClick={() => void savePassword()}>
            保存密码
          </Button>
        </Group>
      </Stack>
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
  );
}
