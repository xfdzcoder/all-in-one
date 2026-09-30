import { useState } from "react";
import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";

import { api } from "./api";
import { ConfirmAction } from "./confirm";
import { useMailAccounts, useMailMutations } from "./data-hooks";
import { WbAlert } from "./ui";

/**
 * 邮箱账号面板（Q26b / D42）：账号增改删 + Gmail OAuth 绑定。
 * 原为邮件组件内弹窗 —— 邮箱属数据源，管理统一迁「数据源管理 · 邮箱」。
 * 口令/令牌入凭证库（SEC3）；删除仅移除配置与凭证引用，邮件保留在邮件服务器（§1.3）。
 */
export function MailAccountsPanel() {
  const { accounts, refresh } = useMailAccounts();
  const m = useMailMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Q27b#2：表单按需展开（列表为主）
  const [formOpenNew, setFormOpenNew] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "993",
    security: "ssl",
    username: "",
    folder: "INBOX",
    password: "",
  });

  const resetForm = () => {
    setEditingId(null);
    setFormError(null);
    setForm({ name: "", host: "", port: "993", security: "ssl", username: "", folder: "INBOX", password: "" });
  };

  const submitAccount = async () => {
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 993,
        security: form.security,
        username: form.username.trim(),
        folder: form.folder.trim() || "INBOX",
        password: form.password || undefined,
      };
      if (editingId) await api.patchMailAccount(editingId, payload);
      else await m.createAccount(payload);
      resetForm();
      refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  const formOpen = Boolean(editingId) || formOpenNew;
  return (
    <Stack gap="xs">
      {/* 四.3：添加入口右上角（对齐看板样式） */}
      <div className="wb-admin__bar">
        <Text size="xs" c="dimmed">
          已添加 {accounts.length} 个账号
        </Text>
        <Button
          size="xs"
          variant={formOpen ? "default" : "filled"}
          className="wb-admin__addbtn"
          onClick={() => setFormOpenNew((v) => !v)}
        >
          {formOpen ? "收起表单" : "＋ 添加邮箱"}
        </Button>
      </div>

      {formOpen && (
      <div className="wb-admin__section">
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
      <Button
        size="xs"
        variant="light"
        onClick={() => {
          void (async () => {
            setFormError(null);
            try {
              const { url } = await api.gmailAuthorize(`${window.location.origin}/api/mail/gmail/callback`);
              window.open(url, "_blank", "noopener");
            } catch (e) {
              setFormError(e instanceof Error ? e.message : String(e));
            }
          })();
        }}
      >
        绑定 Gmail 账号（OAuth）
      </Button>
      {formError && (
        <WbAlert tone="error" size="sm" onClose={() => setFormError(null)}>
          {formError}
        </WbAlert>
      )}
      <Group gap="xs">
        <Button size="xs" onClick={() => void submitAccount()}>
          {editingId ? "保存修改" : "添加账号"}
        </Button>
        {editingId && (
          <Button size="xs" variant="default" onClick={resetForm}>
            取消编辑
          </Button>
        )}
      </Group>
      </div>
      )}

      <Text size="xs" c="dimmed">已添加账号</Text>
      <div className="wb-admin__table">
        {accounts.map((a) => (
          <div key={a.id} className="wb-admin__row" data-admin-row="mail">
            <Text size="sm" className="wb-grow" truncate>
              {a.name} · {a.username}@{a.host}:{a.port} · {a.folder}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setEditingId(a.id);
                setForm({
                  name: a.name,
                  host: a.host,
                  port: String(a.port),
                  security: a.security ?? "ssl",
                  username: a.username,
                  folder: a.folder,
                  password: "",
                });
              }}
            >
              编辑
            </Button>
            <ConfirmAction
              label="删除"
              size="compact-xs"
              variant="subtle"
              title="删除账号？"
              message={`确认删除邮件账号「${a.name}」？（仅移除账号配置与凭证引用，邮件保留在邮件服务器）`}
              onConfirm={() => void m.deleteAccount(a.id).then(() => refresh())}
            />
          </div>
        ))}
        {accounts.length === 0 && (
          <Text size="xs" c="dimmed">
            尚未添加账号
          </Text>
        )}
      </div>
    </Stack>
  );
}
