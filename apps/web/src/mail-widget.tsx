import { useState } from "react";
import { Badge, Button, Card, Group, Select, Stack, Text } from "@mantine/core";

import type { MailListEntry } from "./api";
import { HtmlSandbox } from "./html-sandbox";
import { RelativeTime, WbAlert } from "./ui";
import { useMailAccounts, useMailMessage, useMailMessages } from "./data-hooks";

/**
 * 邮件组件（二期 Q7b，只读聚合 01 FR-E3/§2.3）：多账号列表 + 正文。
 * 正文为不可信 HTML —— 以沙箱 iframe 渲染（D30/D25：deny-all + CSP 禁脚本/远程图）；
 * 账号管理在「数据源管理 · 邮箱」（D42；口令走凭证库 SEC3）；D3 只读：无发送/删除/标记端点。
 */

export function MailWidget({ limit = 20, refreshSec }: { limit?: number; refreshSec?: number }) {
  const [filter, setFilter] = useState<string>("");
  const [open, setOpen] = useState<MailListEntry | null>(null);
  const { accounts } = useMailAccounts();
  const { agg, loading, error, refresh } = useMailMessages(filter || undefined, limit, refreshSec);
  const { message: detail, error: detailError } = useMailMessage(open?.accountId ?? null, open?.uid ?? null);



  return (
    <div className="wb-widget">
      <Group gap={6} wrap="nowrap">
        <Select
          size="compact-xs"
          placeholder="全部账号"
          data={accounts.map((a) => ({ value: a.id, label: a.name }))}
          value={filter || null}
          onChange={(v) => setFilter(v ?? "")}
          clearable
          nothingFoundMessage="暂无账号"
          style={{ width: 140 }}
          aria-label="邮件账号过滤"
        />
        {/* D42：邮箱属数据源 —— 管理统一在「数据源管理 · 邮箱」 */}
        <Button
          size="compact-xs"
          variant="default"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "mail" } }))
          }
        >
          管理邮箱
        </Button>
        <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
          刷新
        </Button>
      </Group>

      {(agg?.errors ?? []).map((e) => (
        <WbAlert key={e.accountId} tone="warning" size="sm">
          {e.accountName}：{e.error}
        </WbAlert>
      ))}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {!open && (
        <Stack gap={4} style={{ flex: 1, overflow: "auto" }}>
          {loading && (
            <Text size="xs" c="dimmed" className="wb-loading">加载中…</Text>
          )}
          {!loading && (agg?.items ?? []).length === 0 && (
            <Text size="xs" c="dimmed">
              {accounts.length === 0 ? "先在「管理邮箱」添加邮箱账号" : "暂无邮件"}
            </Text>
          )}
          {(agg?.items ?? []).map((item) => (
            <Card
              key={`${item.accountId}-${item.uid}`}
              withBorder
              padding={6}
              radius={6}
              className="wb-card--interactive wb-mail-row"
              style={{ cursor: "pointer" }}
              onClick={() => setOpen(item)}
              role="button"
              tabIndex={0}
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
