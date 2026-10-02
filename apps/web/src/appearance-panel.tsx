import { useEffect, useState } from "react";
import { Button, Group, Select, SegmentedControl, Stack, Text, Title } from "@mantine/core";

import { api, type CustomCssBackup } from "./api";
import { CssEditor } from "./css-editor";
import { lintCss } from "./css-hints";
import { ConfirmAction } from "./confirm";
import { WbAlert } from "./ui";

/** 保存即生效：让 `<link href="/custom.css">` 重新取（缓存穿透）。 */
function reloadCustomCss() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="custom.css"]');
  if (link) link.href = `/custom.css?v=${Date.now()}`;
}

/**
 * 外观面板（FR-S3/Q111，**D70**）：深浅色主题切换 + 自定义 CSS 页内编辑器。
 *
 * CSS 编辑器 = CodeMirror 6（语法高亮 + 标准 CSS/`--wb-*` 令牌/`.wb-*` 类名提示）；
 * 保存即生效（bust `/custom.css` 缓存）且**自动备份旧版**、可回滚（服务端历史目录）。
 * 覆盖指南：docs/design-audit/02-custom-css.md。
 */
export function AppearancePanel({
  themeMode,
  onToggleTheme,
}: {
  themeMode: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const [css, setCss] = useState("");
  const [backups, setBackups] = useState<CustomCssBackup[]>([]);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getCustomCss()
      .then((r) => {
        setCss(r.css);
        setBackups(r.backups);
        return true; // promise(always-return)
      })
      .catch((e) => setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) }));
  }, []);

  const save = async () => {
    if (busy) return;
    const issue = lintCss(css);
    setBusy(true);
    try {
      const r = await api.saveCustomCss(css);
      setBackups(r.backups);
      reloadCustomCss();
      setMsg({
        tone: issue ? "info" : "success",
        text: issue ? `已保存，但有一处提示：${issue}` : "已保存并生效（旧版已自动备份）",
      });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!restoreId || busy) return;
    setBusy(true);
    try {
      const r = await api.restoreCustomCss(restoreId);
      setCss(r.css);
      setBackups(r.backups);
      setRestoreId(null);
      reloadCustomCss();
      setMsg({ tone: "success", text: "已回滚到该版本（回滚前的版本也已备份）" });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md" className="wb-settings__section">
      <Title order={5}>外观</Title>
      {msg && (
        <WbAlert tone={msg.tone} size="sm" onClose={() => setMsg(null)}>
          {msg.text}
        </WbAlert>
      )}
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          主题
        </Text>
        <SegmentedControl
          size="xs"
          value={themeMode}
          onChange={(v) => {
            if ((v === "dark") !== (themeMode === "dark")) onToggleTheme();
          }}
          data={[
            { label: "深色", value: "dark" },
            { label: "浅色", value: "light" },
          ]}
        />
      </Group>
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          自定义 CSS（保存即生效；令牌与类名见提示，或参考
          <code> docs/design-audit/02-custom-css.md</code>）
        </Text>
        <CssEditor value={css} onChange={setCss} />
        <Group gap="xs">
          <Button size="xs" disabled={busy} onClick={() => void save()}>
            保存 CSS
          </Button>
          <ConfirmAction
            label="清空并保存"
            size="compact-xs"
            title="清空自定义 CSS？"
            message="当前自定义样式会被清空（清空前自动备份，可从历史回滚）。"
            onConfirm={() => {
              setCss("");
              void api.saveCustomCss("").then((r) => {
                setBackups(r.backups);
                reloadCustomCss();
                setMsg({ tone: "success", text: "已清空（旧版已自动备份）" });
                return true; // promise(always-return)
              });
            }}
          />
          <Select
            size="xs"
            className="wb-flex-1"
            placeholder={backups.length ? "回滚到历史版本…" : "暂无历史版本"}
            data={backups.map((b) => ({ value: b.id, label: `${b.at}（${b.size} 字节）` }))}
            value={restoreId}
            onChange={(v) => setRestoreId(v)}
            disabled={!backups.length}
            searchable
          />
          <Button size="xs" variant="default" disabled={!restoreId || busy} onClick={() => void restore()}>
            回滚
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
