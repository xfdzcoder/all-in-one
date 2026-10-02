import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";

import type { MailListEntry } from "./api";
import { HtmlSandbox } from "./html-sandbox";
import { RelativeTime, WbAlert, WbLoading, IconAction } from "./ui";
import { WidgetTitle } from "./widget-title";
import { useMailAccounts, useMailMessage, useMailMessages } from "./data-hooks";

/**
 * 邮件组件（二期 Q7b，只读聚合 01 FR-E3/§2.3）：多账号列表 + 正文。
 * 正文为不可信 HTML —— 以沙箱 iframe 渲染（D30/D25：deny-all + CSP 禁脚本/远程图）；
 * 账号管理在「数据源管理 · 邮箱」（D42；口令走凭证库 SEC3）；D3 只读：无发送/删除/标记端点。
 * Q68（项 2）：卡片左上角显示本卡覆盖的邮箱（账号名 `name`，`，`连接、单行省略号），
 * 不再有「管理邮箱」按钮 —— 管理入口统一在头部「数据源管理」。
 */

export function MailWidget({
  limit = 20,
  refreshSec,
  accountIds,
}: {
  limit?: number;
  refreshSec?: number;
  /** Q29e/四.2：配置多选邮箱（留空 = 全部）；组合倒序（聚合已按新→旧）。 */
  accountIds?: string[];
}) {
  const [open, setOpen] = useState<MailListEntry | null>(null);
  const { accounts } = useMailAccounts();
  // WEB-1：选中的账号下推服务端过滤（原先取全局 20 封再客户端过滤，选单个账号时近乎空白）。
  // **入参防呆**（Q93 同族）：multiselect 默认值是空串 `""`，`("" ?? []).filter` 直接 TypeError
  // ⇒ 整卡进错误态（实测崩因 `(n ?? []).filter is not a function`）——非数组一律归一为空。
  const selectedIds = Array.isArray(accountIds) ? accountIds.filter((x) => typeof x === "string" && x) : [];
  const { agg, loading, error, refresh } = useMailMessages(selectedIds, limit, refreshSec);
  const { message: detail, error: detailError } = useMailMessage(open?.accountId ?? null, open?.uid ?? null);
  // Q29e/四.2：配置多选邮箱（留空 = 全部）；过滤已下推服务端（WEB-1），这里只用于标签展示
  const allowIds = selectedIds.length > 0 ? new Set(selectedIds) : null;

  // 项 2：卡片左上角显示本卡覆盖的邮箱（多账号用「，」连接；仅允许一行，超出省略号）。
  // 显示名取 `name`（与组件配置里多选下拉的标签同源，用户看到的就是他勾选的）。
  const shownAccounts = allowIds ? accounts.filter((a) => allowIds.has(a.id)) : accounts;
  const mailboxLabel = shownAccounts.map((a) => a.name).filter(Boolean).join("，") || "全部邮箱";

  return (
    // 语义类 wb-widget--mail（D39：类名即公共 API，可被 /custom.css 按组件覆盖）
    <div className="wb-widget wb-widget--mail">
      <Group gap={6} wrap="nowrap">
        {/* 项 2：左上角邮箱信息 —— 单行 + 省略号（tooltip 可看全名） */}
        <WidgetTitle title={mailboxLabel} className="wb-mailbox-label" tip={mailboxLabel} />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {(agg?.errors ?? []).map((e) => (
        <WbAlert key={e.accountId} tone="warning" size="sm">
          {e.accountName}：{e.error}
        </WbAlert>
      ))}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {!open && (
        <Stack gap={4} style={{ flex: 1, overflow: "auto" }}>
          {loading && <WbLoading />}
          {!loading && (agg?.items ?? []).length === 0 && (
            <Text size="xs" c="dimmed">
              {accounts.length === 0 ? "先在「数据源管理 · 邮箱」添加邮箱账号" : "暂无邮件"}
            </Text>
          )}
          {(agg?.items ?? []).map((item) => (
            <Card
              key={`${item.accountId}-${item.uid}`}
              withBorder
              padding={6}
              radius={6}
              component="button"
              type="button"
              className="wb-card--interactive wb-mail-row"
              style={{ cursor: "pointer", textAlign: "inherit" }}
              onClick={() => setOpen(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(item);
                }
              }}
            >
              <Group gap={6} wrap="nowrap">
                {!item.seen && <Badge size="xs" color="blue" circle>
                  &nbsp;
                </Badge>}
                <Text size="xs" fw={item.seen ? 400 : 600} style={{ flex: 1 }} lineClamp={1}>
                  {item.subject}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.accountName}
                </Text>
              </Group>
              <Group gap={6} justify="space-between">
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {item.from}
                </Text>
                <Text size="xs" c="dimmed">
                  <RelativeTime value={item.date} />
                </Text>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {open && (
        <Stack gap={4} style={{ flex: 1, overflow: "hidden" }}>
          <Group gap={6}>
            <Button size="compact-xs" variant="subtle" onClick={() => setOpen(null)}>
              ← 返回
            </Button>
            <Text size="xs" fw={600} style={{ flex: 1 }} lineClamp={1}>
              {open.subject}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {open.from} · <RelativeTime value={open.date} /> · {open.accountName}
          </Text>
          {detailError && <WbAlert tone="error" size="sm">{detailError}</WbAlert>}
          {!detail && (
            <Text size="xs" c="dimmed">
              正文加载中…
            </Text>
          )}
          {detail && detail.html && <HtmlSandbox html={detail.html} title={`mail-${open.uid}`} />}
          {detail && !detail.html && (
            <pre style={{ margin: 0, flex: 1, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 12 }}>{detail.text}</pre>
          )}
        </Stack>
      )}

    </div>
  );
}
