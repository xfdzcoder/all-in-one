import type { WidgetConnector, WidgetDataQuery, FetchContext } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * OpenCode connector（FR-E4/06 §1"会话列表/状态/耗时 + API 版本探测"）。
 * 薄封装 opencode server 的 HTTP API（experimental —— 见 D32：直接 HTTP 绑定、
 * 不引 SDK 以缩小变动面）；**版本探测 + 容错**：API 形状不符/不可达时不抛错，
 * 返回 probe 结果由组件显式提示（"实验性 API 不兼容"），而不是空白。
 * 目标为本机/内网 opencode server（服务聚合核心场景）→ allowPrivate 通道（D22 同族）。
 */

interface OpencodeSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 会话持续时长（updatedAt - createdAt，毫秒）。 */
  durationMs: number;
}

interface OpencodeData {
  probe: { ok: boolean; version?: string; error?: string };
  sessions: OpencodeSession[];
}

const TIMEOUT_MS = 8000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** opencode session 形状探测（experimental API）：兼容 time.{created,updated} 与扁平字段。 */
function normalizeSession(raw: unknown): OpencodeSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!id) return null;
  const time = (r.time ?? {}) as Record<string, unknown>;
  const createdAt = num(time.created) || num(r.createdAt);
  const updatedAt = num(time.updated) || num(r.updatedAt) || createdAt;
  return {
    id,
    title: typeof r.title === "string" && r.title ? r.title : "(无标题会话)",
    createdAt,
    updatedAt,
    durationMs: Math.max(0, updatedAt - createdAt),
  };
}

export const opencodeConnector: WidgetConnector = {
  type: "opencode",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<OpencodeData> {
    const config = await resolveSecretRefs(query.config, ctx);
    const base = String(config.url ?? "").replace(/\/+$/, "");
    const token = typeof config.apiToken === "string" ? config.apiToken : "";
    const limit = Math.min(Math.max(Number(config.limit) || 20, 1), 50);
    if (!base) return { probe: { ok: false, error: "未配置 opencode server 地址" }, sessions: [] };

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    // ① API 版本探测：/app（best-effort，失败不致命）
    let version: string | undefined;
    try {
      const app = await outboundRequest(`${base}/app`, {
        headers,
        timeoutMs: TIMEOUT_MS,
        maxBytes: 200_000,
        allowPrivate: true, // D32：opencode server 即本机/内网服务（服务聚合族）
      });
      if (app.status < 400) {
        const parsed = JSON.parse(app.text) as Record<string, unknown>;
        if (typeof parsed?.version === "string") version = parsed.version;
      }
    } catch {
      /* 版本探测失败不阻断会话列表 */
    }

    // ② 会话列表（experimental：形状不符时给出明确 probe.error）
    try {
      const res = await outboundRequest(`${base}/session`, {
        headers,
        timeoutMs: TIMEOUT_MS,
        maxBytes: 1_000_000,
        allowPrivate: true, // D32：opencode server 即本机/内网服务（服务聚合族）
      });
      if (res.status >= 400) {
        return {
          probe: { ok: false, version, error: `opencode API HTTP ${res.status}（experimental 接口可能已变更）` },
          sessions: [],
        };
      }
      const parsed: unknown = JSON.parse(res.text);
      const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { sessions?: unknown[] })?.sessions) ? (parsed as { sessions: unknown[] }).sessions : null;
      if (!list) {
        return {
          probe: { ok: false, version, error: "opencode API 响应形状不符（experimental 接口可能已变更）" },
          sessions: [],
        };
      }
      const sessions = list
        .map(normalizeSession)
        .filter((s): s is OpencodeSession => s !== null)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
      return { probe: { ok: true, version }, sessions };
    } catch (e) {
      return {
        probe: { ok: false, version, error: e instanceof Error ? e.message : "opencode server 不可达" },
        sessions: [],
      };
    }
  },
};
