import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

import type { MailListEntry } from "./api";
import {
  useMailAccounts,
  useMailMessage,
  useMailMessages,
  useMailMutations,
} from "./data-hooks";

/**
 * 邮件组件（二期 Q7b，只读聚合 01 FR-E3/§2.3）：多账号列表 + 正文。
 * 正文为不可信 HTML —— 以沙箱 iframe 渲染（D30/D25：deny-all + CSP 禁脚本/远程图）；
 * 账号管理在组件内（口令走凭证库 SEC3）；D3 只读：无发送/删除/标记端点。
 */

/** 正文沙箱：脚本永不执行（sandbox="" + CSP script-src 'none' 双保险）。 */
function HtmlSandbox({ html, title }: { html: string; title: string }) {
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src 'none'; form-action 'none'; base-uri 'none'"></head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={srcDoc}
      style={{ width: "100%", height: "100%", minHeight: 200, border: 0, borderRadius: 6, background: "#fff" }}
    />
  );
}

export function MailWidget({ limit = 20 }: { limit?: number }) {
  const [filter, setFilter] = useState<string>("");
  const [open, setOpen] = useState<MailListEntry | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const { accounts, refresh: refreshAccounts } = useMailAccounts();
  const { agg, loading, error, refresh } = useMailMessages(filter || undefined, limit);
  const { message: detail, error: detailError } = useMailMessage(open?.accountId ?? null, open?.uid ?? null);
  const m = useMailMutations();

  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "993",
    security: "ssl",
    username: "",
    folder: "INBOX",
    password: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const submitAccount = async () => {
    setFormError(null);
    try {
      await m.createAccount({
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 993,
        security: form.security,
        username: form.username.trim(),
        folder: form.folder.trim() || "INBOX",
        password: form.password || undefined,
      });
      setForm({ name: "", host: "", port: "993", security: "ssl", username: "", folder: "INBOX", password: "" });
      refreshAccounts();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Stack gap={6} style={{ height: "100%", overflow: "hidden" }}>
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
        <Button size="compact-xs" variant="light" onClick={() => setAccountsOpen(true)}>
          管理账号
        </Button>
        <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
          刷新
        </Button>
      </Group>

      {(agg?.errors ?? []).map((e) => (
        <Alert key={e.accountId} color="yellow" py={2}>
          <Text size="xs">
            {e.accountName}：{e.error}
          </Text>
        </Alert>
      ))}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}

      {!open && (
        <Stack gap={4} style={{ flex: 1, overflow: "auto" }}>
          {loading && (
            <Text size="xs" c="dimmed">
              加载中…
            </Text>
          )}
          {!loading && (agg?.items ?? []).length === 0 && (
            <Text size="xs" c="dimmed">
              {accounts.length === 0 ? "先在「管理账号」添加邮箱账号" : "暂无邮件"}
            </Text>
          )}
          {(agg?.items ?? []).map((item) => (
            <Card
              key={`${item.accountId}-${item.uid}`}
              withBorder
              padding={6}
              radius={6}
              style={{ cursor: "pointer" }}
              onClick={() => setOpen(item)}
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
                  {item.date.slice(0, 10)}
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
            {open.from} · {open.date.slice(0, 16).replace("T", " ")} · {open.accountName}
          </Text>
          {detailError && (
            <Text size="xs" c="red">
              {detailError}
            </Text>
          )}
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

      <Modal opened={accountsOpen} onClose={() => setAccountsOpen(false)} title="邮件账号" size="lg">
        <Stack gap="xs">
          <Group gap="xs" grow>
            <TextInput size="xs" label="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <TextInput size="xs" label="服务器" value={form.host} onChange={(e) => setForm({ ...form, host: e.currentTarget.value })} />
          </Group>
          <Group gap="xs" grow>
            <TextInput size="xs" label="端口" value={form.port} onChange={(e) => setForm({ ...form, port: e.currentTarget.value })} />
            <Select
              size="xs"
              label="加密"
              data={[
                { value: "ssl", label: "SSL（993）" },
                { value: "starttls", label: "STARTTLS" },
                { value: "plain", label: "明文" },
              ]}
              value={form.security}
              onChange={(v) => setForm({ ...form, security: v ?? "ssl" })}
            />
          </Group>
          <Group gap="xs" grow>
            <TextInput size="xs" label="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.currentTarget.value })} />
            <TextInput size="xs" label="文件夹" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.currentTarget.value })} />
          </Group>
          <TextInput
            size="xs"
            label="口令/应用专用密码"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
            description="存入凭证库，账号只保存引用（SEC3）"
          />
          {formError && (
            <Text size="xs" c="red">
              {formError}
            </Text>
          )}
          <Button size="xs" onClick={() => void submitAccount()}>
            添加账号
          </Button>
          <Stack gap={4}>
            {accounts.map((a) => (
              <Group key={a.id} gap="xs" justify="space-between">
                <Text size="xs">
                  {a.name} · {a.username}@{a.host}:{a.port} · {a.folder}
                </Text>
                <Button
                  size="compact-xs"
                  color="red"
                  variant="light"
                  onClick={() => void m.deleteAccount(a.id).then(() => refreshAccounts())}
                >
                  删除
                </Button>
              </Group>
            ))}
            {accounts.length === 0 && (
              <Text size="xs" c="dimmed">
                尚未添加账号
              </Text>
            )}
          </Stack>
        </Stack>
      </Modal>
    </Stack>
  );
}
