import { useRef, useState } from "react";
import {
  Badge,
  Button,
  FileInput,
  Group,
  List,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import type { PluginManifest } from "@all-in-one/widget-sdk";

import { api, type PluginRow } from "./api";
import { ConfirmAction } from "./confirm";
import { queryClient, usePlugins } from "./data-hooks";

/**
 * 插件管理（FR-W6）：上传安装（zip）→ 启用 / 禁用 / 卸载，权限声明展示（FR-W7）。
 * 所有变更后失效 ["plugins"] 查询 —— 选择器/组件注册即刻可见（无需刷新）。
 * 仅桌面端入口（D10：移动端纯浏览，不做管理操作）。
 */

const MAX_PACKAGE_BYTES = 1_500_000;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  enabled: { label: "已启用", color: "green" },
  disabled: { label: "已禁用", color: "gray" },
  installed: { label: "未启用", color: "yellow" },
};

function parseManifest(row: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(row.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

function PermissionsSummary({ manifest }: { manifest: PluginManifest | null }) {
  const perms = manifest?.plugin.permissions ?? {};
  const chips = [
    ...(perms.apis ?? []).map((a) => `API:${a}`),
    ...(perms.credentialKinds ?? []).map((k) => `凭证:${k}`),
    ...(perms.actions ?? []).map((a) => `动作:${a}`),
  ];
  if (chips.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        权限：无（最小权限）
      </Text>
    );
  }
  return (
    <Group gap={4}>
      <Text size="xs" c="dimmed">
        权限：
      </Text>
      {chips.map((c) => (
        <Badge key={c} size="xs" variant="outline">
          {c}
        </Badge>
      ))}
    </Group>
  );
}

export function PluginAdmin({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { plugins, refresh } = usePlugins();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    refresh();
  };

  const install = async () => {
    if (!file) return;
    if (file.size > MAX_PACKAGE_BYTES) {
      setMessage({ kind: "error", text: `插件包过大（>${Math.round(MAX_PACKAGE_BYTES / 1_000_000)}MB）` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const row = await api.installPlugin(base64);
      setMessage({ kind: "ok", text: `已安装：${row.name}（${row.type}）` });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row: PluginRow, enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.setPluginStatus(row.id, enabled);
      invalidate();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (row: PluginRow) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.uninstallPlugin(row.id);
      setMessage({ kind: "ok", text: `已卸载：${row.name}` });
      invalidate();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="插件管理" size="lg">
      <Stack gap="sm">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <FileInput
            label="插件包（zip：manifest.json + 入口模块）"
            placeholder="选择 .zip 文件"
            accept=".zip,application/zip"
            value={file}
            onChange={setFile}
            style={{ flex: 1 }}
            size="xs"
          />
          <Button size="xs" onClick={() => void install()} disabled={!file || busy}>
            安装
          </Button>
        </Group>
        {message && (
          <Text size="xs" c={message.kind === "ok" ? "green" : "red"}>
            {message.text}
          </Text>
        )}
        <List size="xs" spacing="xs">
          {plugins.length === 0 && (
            <List.Item>
              <div
                className={`wb-dropzone${dragOver ? " wb-dropzone--over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
              >
                <Text size="xs" c="dimmed">
                  尚未安装插件
                </Text>
                <Text size="xs" c="dimmed">
                  把插件包（zip：manifest.json + 入口模块）拖到这里，或用上方「选择 .zip 文件」安装。
                </Text>
              </div>
            </List.Item>
          )}
          {plugins.map((row) => {
            const manifest = parseManifest(row);
            const status = STATUS_LABEL[row.status] ?? { label: row.status, color: "gray" };
            return (
              <List.Item key={row.id}>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>
                        {row.name}
                      </Text>
                      <Badge size="xs" color={status.color} variant="light">
                        {status.label}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {row.type} · apiVersion {manifest?.plugin.apiVersion ?? "?"}
                    </Text>
                    <PermissionsSummary manifest={manifest} />
                  </Stack>
                  <Group gap={4}>
                    {row.status === "enabled" ? (
                      <Button size="compact-xs" variant="default" disabled={busy} onClick={() => void setStatus(row, false)}>
                        禁用
                      </Button>
                    ) : (
                      <Button size="compact-xs" variant="light" disabled={busy} onClick={() => void setStatus(row, true)}>
                        启用
                      </Button>
                    )}
                    <ConfirmAction
                      label="卸载"
                      size="compact-xs"
                      title="卸载插件？"
                      message={`确认卸载插件「${row.name}」？（删除安装文件与登记；已添加的插件组件将失效）`}
                      onConfirm={() => void uninstall(row)}
                    />
                  </Group>
                </Group>
              </List.Item>
            );
          })}
        </List>
      </Stack>
    </Modal>
  );
}
