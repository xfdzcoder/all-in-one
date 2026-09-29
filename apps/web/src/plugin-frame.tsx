import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Text } from "@mantine/core";
import type { ConfigValues, PluginManifest } from "@all-in-one/widget-sdk";

import { api } from "./api";
import { queryClient, usePluginData } from "./data-hooks";

/**
 * 插件沙箱宿主（FR-W7 / **D25**：iframe CSP 隔离，否决 Web Component 方案）。
 *
 * 隔离要点（K7"仅前端渲染 + 宿主统一数据通道"）：
 * - `sandbox="allow-scripts"`（无 allow-same-origin）→ 不透明源：插件碰不到宿主
 *   DOM/JS 作用域、cookie、localStorage；
 * - CSP：`connect-src 'none'` 等 → 插件**不能直连任何网络**（含内网），数据只能
 *   由宿主取好后经桥传入；`img-src data:`、`frame-src 'none'`、`form-action 'none'`；
 * - 入口模块经 data: URL 在框内 `import()`（自包含、不允许 import 外部模块），
 *   源码永不进入宿主 JS 作用域；
 * - 宿主 ↔ 插件只交换结构化 postMessage（source 标识 + sourceWindow 校验）。
 *
 * 运行时 ABI：入口默认导出 `render(props, ctx)`；props = `{ config, data }`；
 * ctx = `{ root, onAction(name, params), onResize(height), onError(err) }`。
 */

export type PluginRuntimeProps = { config: ConfigValues; data: unknown };

type FrameOut =
  | { source: "aio-plugin"; t: "waiting" }
  | { source: "aio-plugin"; t: "rendered" }
  | { source: "aio-plugin"; t: "action"; name: string; params?: unknown }
  | { source: "aio-plugin"; t: "resize"; height: number }
  | { source: "aio-plugin"; t: "error"; message: string };

/** 框内 bootstrap：加载入口模块、接 props、发事件（作为内联 module script 注入）。 */
function buildBootstrap(code: string): string {
  return `
const CODE = ${JSON.stringify(code)};
const post = (m) => parent.postMessage({ source: "aio-plugin", ...m }, "*");
const ctx = {
  root: document.getElementById("root"),
  onAction: (name, params) => post({ t: "action", name, params }),
  onResize: (height) => post({ t: "resize", height }),
  onError: (err) => post({ t: "error", message: String(err && err.message ? err.message : err) }),
};
let renderFn = null;
const call = (props) => {
  try {
    if (typeof renderFn === "function") {
      renderFn(props, ctx);
      post({ t: "rendered" });
    }
  } catch (e) {
    ctx.onError(e);
  }
};
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.source !== "aio-host") return;
  if (d.t === "props") call(d.props);
});
try {
  const mod = await import("data:text/javascript," + encodeURIComponent(CODE));
  renderFn = mod && mod.default;
  if (typeof renderFn !== "function") throw new Error("entry module must default-export render(props, ctx)");
  post({ t: "waiting" });
} catch (e) {
  ctx.onError("plugin load failed: " + (e && e.message ? e.message : e));
}
`;
}

function buildSrcDoc(nonce: string, code: string): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' data:`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;height:100%;font:13px/1.5 system-ui,sans-serif;color:#e9ecef;background:transparent}#root{height:100%;overflow:auto}</style></head><body><div id="root"></div><script type="module" nonce="${nonce}">${buildBootstrap(code)}</script></body></html>`;
}

export function PluginFrame({
  pluginId,
  manifest,
  config,
}: {
  pluginId: string;
  manifest: PluginManifest;
  config: ConfigValues;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // 数据桥：宿主统一取数（FR-W3），权限由服务端按白名单把关（D26）
  const { data, error: dataError } = usePluginData(
    manifest.type,
    manifest.capabilities?.data?.source,
    config,
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const propsRef = useRef<PluginRuntimeProps>({ config, data });
  propsRef.current = { config, data };
  // 每次挂载一个随机 nonce —— 框内脚本仅限 bootstrap（插件代码经 data: 模块导入）
  const nonce = useMemo(() => crypto.randomUUID().replace(/-/g, ""), []);
  const srcDoc = useMemo(() => (code === null ? "" : buildSrcDoc(nonce, code)), [nonce, code]);

  useEffect(() => {
    let cancelled = false;
    api
      .getPluginEntry(pluginId)
      .then((entry) => {
        if (!cancelled) setCode(entry.code);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  const postProps = () => {
    frameRef.current?.contentWindow?.postMessage(
      { source: "aio-host", t: "props", props: propsRef.current },
      "*",
    );
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // 只接受本 iframe 发来的消息（不透明源 origin === "null"，故按 sourceWindow 校验）
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as FrameOut | null;
      if (!d || d.source !== "aio-plugin") return;
      switch (d.t) {
        case "waiting":
        case "rendered":
          postProps();
          break;
        case "action": {
          // FR-W7：动作走显式白名单，未声明即拒绝（服务端 D27 复核 + 执行 + 审计）
          const allowed = manifest.plugin.permissions?.actions ?? [];
          if (!allowed.includes(d.name)) {
            setRuntimeError(`动作 ${d.name} 未在 permissions.actions 声明，已拒绝`);
            break;
          }
          api
            .pluginAction(pluginId, d.name, d.params)
            .then(() => {
              // 动作可能改动 todo/feed 数据 —— 刷新插件数据桥（SSE 另有失效通知）
              void queryClient.invalidateQueries({ queryKey: ["plugin-data"] });
            })
            .catch((e: unknown) => {
              setRuntimeError(`动作执行失败：${e instanceof Error ? e.message : String(e)}`);
            });
          break;
        }
        case "error":
          setRuntimeError(d.message);
          break;
        case "resize":
          // v1 固定单元格高度；预留后续接 gridstack 高度自适应
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // postProps 每次渲染重建无妨（只读 propsRef）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, pluginId]);

  // props 变更 → 推入框内重新渲染（FR-W4 配置变更/数据刷新路径）
  useEffect(() => {
    postProps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, data, code]);

  if (loadError) {
    return (
      <Text size="xs" c="red">
        插件加载失败：{loadError}
      </Text>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {runtimeError && (
        <Alert color="red" mb={4}>
          {runtimeError}
        </Alert>
      )}
      {dataError && (
        <Alert color="red" mb={4}>
          数据获取失败：{dataError}
        </Alert>
      )}
      {code !== null && (
        <iframe
          ref={frameRef}
          title={`plugin-${manifest.type}`}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ flex: 1, width: "100%", border: 0, borderRadius: 6 }}
        />
      )}
    </div>
  );
}
