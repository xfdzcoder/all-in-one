import { useRef, useState } from "react";
import { Button, Group, Paper, PasswordInput, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";

import { api, ApiError } from "./api";
import { WbAlert } from "./ui";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "用户名或口令错误" : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper
      component="form"
      onSubmit={submit}
      p="xl"
      radius="md"
      withBorder
      style={{ width: 360, margin: "12vh auto" }}
    >
      <Stack>
        {/* ISS-8：品牌图标与头部一致 */}
        <Group gap={8}>
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <Title order={3}>个人工作台</Title>
        </Group>
        <TextInput
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          required
          autoComplete="username"
        />
        <PasswordInput
          label="口令"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
          autoComplete="current-password"
          ref={passwordRef}
        />
        {error && <WbAlert tone="error">{error}</WbAlert>}
        <Button type="submit" loading={busy}>
          登录
        </Button>
        {/* ISS-9：按钮语义（可聚焦、可回车、aria-expanded） */}
        <UnstyledButton
          className="wb-login-hint"
          aria-expanded={hintOpen}
          onClick={() => setHintOpen((v) => !v)}
        >
          忘记口令？
        </UnstyledButton>
        {hintOpen && (
          <Text size="xs" c="dimmed">
            管理员口令在部署时设置；遗忘时在服务器上修改后重启服务即可（详见部署文档）。
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
