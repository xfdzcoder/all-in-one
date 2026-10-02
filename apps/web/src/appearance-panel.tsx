import { useEffect, useState } from "react";
import { lazy, Suspense } from "react";
import { Button, Group, SegmentedControl, Select, Stack, Switch, Text, Title } from "@mantine/core";

import { api, type CustomCssBackup } from "./api";
import { lintCss } from "./css-hints";
import { ConfirmAction } from "./confirm";
import { WbAlert, WbLoading } from "./ui";

// Q115 批1：CodeMirror（dev 预构建 ~3MB）懒加载 —— 只在打开「外观」面板时才拉
const CssEditor = lazy(() => import("./css-editor").then((m) => ({ default: m.CssEditor })));

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
  pageWrap,
  onTogglePageWrap,
}: {
  themeMode: "dark" | "light";
  onToggleTheme: () => void;
  /** Q120：多页面横向切换「到头循环」（默认关 = 回弹）。 */
  pageWrap: boolean;
  onTogglePageWrap: () => void;
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
    <Stack gap="lg" className="wb-settings__section">
      <Title order={5}>外观</Title>
      {msg && (
        <WbAlert tone={msg.tone} size="sm" onClose={() => setMsg(null)}>
          {msg.text}
        </WbAlert>
      )}
      {/* Q118（用户反馈「太挤」）：主题 / 自定义 CSS 分成两个留白充分的区块 */}
      <div className="wb-settings__card">
        <Stack gap="sm">
          <div>
            <Title order={6}>主题</Title>
            <Text size="sm" c="dimmed">
              深浅色切换，全站即时生效。
            </Text>
          </div>
          <SegmentedControl
            size="xs"
            w="fit-content"
            value={themeMode}
            onChange={(v) => {
              if ((v === "dark") !== (themeMode === "dark")) onToggleTheme();
            }}
            data={[
              { label: "深色", value: "dark" },
              { label: "浅色", value: "light" },
            ]}
          />
          {/* Q120：多页面横向切换的首尾行为（默认回弹；开 = 到头切到另一头） */}
          <Switch
            label="循环切换页面"
            description="横向切换到头时继续滑动，切到另一头（关闭则到头回弹）"
            checked={pageWrap}
            onChange={onTogglePageWrap}
            labelPosition="left"
            w="fit-content"
          />
        </Stack>
      </div>
      <div className="wb-settings__card">
        <Stack gap="sm">
          <div>
            <Title order={6}>自定义 CSS</Title>
            <Text size="sm" c="dimmed">
              保存即生效；<code>--wb-*</code> 令牌与 <code>.wb-*</code> 类名有提示，或参考
              <code> docs/design-audit/02-custom-css.md</code>。
            </Text>
          </div>
          <Suspense fallback={<WbLoading />}>
            <CssEditor value={css} onChange={setCss} />
          </Suspense>
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
      </div>
    </Stack>
  );
}
