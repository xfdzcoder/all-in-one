import { useEffect, useRef, useState } from "react";
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";

import { api, type IconRow } from "./api";
import { qk, qkRoot } from "./query-keys";
import { copyText } from "./clipboard";
import { ConfirmAction } from "./confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ServiceIcon } from "./service-icon";
import { WbAlert } from "./ui";

const MAX_BYTES = 512 * 1024;
const OK_MIME = new Set(["image/svg+xml", "image/png", "image/webp"]);

/**
 * 自定义图标库管理面（Q38b/D45）：上传 SVG/PNG/WebP、清单、引用地址、删除（确认）。
 * SVG 服务端净化（防 script 注入）+ 下发 CSP sandbox（D25 同族）；引用 = /api/icons/:id 或 custom:<id>。
 */
export function IconLibrary() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: qk.icons, queryFn: () => api.listIcons() });
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, []);

  const rows: IconRow[] = list.data ?? [];

  const upload = async () => {
    setError(null);
    if (!name.trim() || !file) return;
    if (!OK_MIME.has(file.type)) {
      setError("仅支持 SVG / PNG / WebP");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("图标不能超过 512KB");
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.addEventListener("load", () => resolve(String(r.result).split(",")[1] ?? ""));
        r.addEventListener("error", () => reject(new Error("读取文件失败")));
        r.readAsDataURL(file);
      });
      await api.createIcon({ name: name.trim(), mime: file.type, dataBase64 });
      setName("");
      setFile(null);
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: qkRoot.icons });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="xs">
      {error && (
        <WbAlert tone="error" size="sm" onClose={() => setError(null)}>
          {error}
        </WbAlert>
      )}
      <div className="wb-admin__bar">
        <Text size="xs" c="dimmed">
          已上传 {rows.length} 个图标 · 引用地址 = /api/icons/&lt;id&gt;（或配置里写 custom:&lt;id&gt;）
        </Text>
        <Button
          size="xs"
          variant={formOpen ? "default" : "filled"}
          className="wb-admin__bar-right"
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? "收起表单" : "＋ 上传图标"}
        </Button>
      </div>
      {formOpen && (
        <div className="wb-admin__section">
          <Text size="xs" c="dimmed">
            上传图标（SVG 服务端净化；≤512KB）
          </Text>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              placeholder="图标名称"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className="wb-col-160"
            />
            <input
              type="file"
              accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
              aria-label="图标文件"
              onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            />
            <Button size="xs" disabled={!name.trim() || !file || busy} onClick={() => void upload()}>
              上传
            </Button>
          </Group>
        </div>
      )}
      <div className="wb-admin__table">
        {rows.map((r) => (
          <div key={r.id} className="wb-admin__row" data-admin-row="icon">
            <span className="wb-source-logo" aria-hidden>
              <ServiceIcon name={`/api/icons/${r.id}`} size={22} />
            </span>
            <Text size="sm" fw={600} className="wb-col-140" truncate>
              {r.name}
            </Text>
            <Text size="xs" c="dimmed" className="wb-grow" truncate>
              {r.mime} · {Math.max(1, Math.round(r.size / 1024))}KB
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                // Q80：copyText 自带降级（HTTP 下 navigator.clipboard 不可用）
                void copyText(`/api/icons/${r.id}`).then((ok) => {
                  if (!ok) return ok;
                  setCopied(r.id);
                  // WEB-28：复位定时器随组件卸载清理，避免卸载后 setState
                  if (copyTimer.current !== null) clearTimeout(copyTimer.current);
                  copyTimer.current = window.setTimeout(() => setCopied(null), 2000);
                  return ok; // promise(always-return)：链式语义明确
                });
              }}
            >
              {copied === r.id ? "已复制" : "复制地址"}
            </Button>
            <ConfirmAction
              label="删除"
              size="compact-xs"
              variant="subtle"
              title="删除图标？"
              message={`确认删除图标「${r.name}」？（引用它的配置将无法显示图标；业务数据保留）`}
              onConfirm={() => {
                void api.deleteIcon(r.id).then(() => qc.invalidateQueries({ queryKey: qkRoot.icons }));
              }}
            />
          </div>
        ))}
        {rows.length === 0 && <Text size="xs" c="dimmed">暂无自定义图标 —— 上传后可在配置里引用</Text>}
      </div>
    </Stack>
  );
}
