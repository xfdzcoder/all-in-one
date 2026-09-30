import { useState } from "react";
import { Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";

import { api, ApiError } from "./api";
import { WbAlert } from "./ui";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <Title order={3}>个人工作台</Title>
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
        />
        {error && <WbAlert tone="error">{error}</WbAlert>}
        <Button type="submit" loading={busy}>
          登录
        </Button>
        <Text size="xs" c="dimmed">
          首次部署请设置 ADMIN_PASSWORD 环境变量（D17）
        </Text>
      </Stack>
    </Paper>
  );
}
