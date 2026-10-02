import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { str } from "./normalize.ts";
import { outboundRequest, resolveSecretRefs, loadSourceConfig } from "./registry.ts";

/**
 * Portainer 容器清单（FR-X3 只读深度，**D50**）：状态/端口/镜像 + 日志尾部（只读）。
 * - `GET /api/endpoints/:ep/docker/containers/json?all=1`（真机实测 2.27.6 可用）；
 * - 日志 `.../containers/:id/logs?tail=N`（stdout+stderr，只读）；
 * - 只读边界（D50）：无启停/重启/删除（写操作待拍板，FR-X3b）。
 */

export interface PortainerContainerItem {
  id: string;
  name: string;
  state: string;
  /** Docker Status 文本（"Up 2 days" / "Exited (143) 3 days ago"）。 */
  status: string;
  image?: string;
  ports?: string;
  /** 异常 = 非 running/created/paused 且（Exited 非 0 或其它状态）。 */
  abnormal: boolean;
}

interface PortainerContainersData {
  containers: PortainerContainerItem[];
  notes?: string[];
}

const TIMEOUT_MS = 8000;

/** 归一：containers/json 数组 → 清单项（可单测）。 */
export function normalizePortainerContainers(raw: unknown): PortainerContainerItem[] {
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  return list.map((c) => {
    const state = str(c.State) ?? "unknown";
    const status = str(c.Status) ?? "";
    const m = status.match(/Exited \((\d+)\)/);
    const abnormal = state !== "running" && state !== "created" && state !== "paused" && (!m || Number(m[1]) !== 0);
    const ports = Array.isArray(c.Ports)
      ? (c.Ports as Array<Record<string, unknown>>)
          .map((p) => {
            const pub = typeof p.PublicPort === "number" ? `${p.PublicPort}→` : "";
            return `${pub}${p.PrivatePort ?? "?"}${p.Type ? `/${p.Type}` : ""}`;
          })
          .filter((s) => s && !s.startsWith("?"))
          .join(" · ")
      : undefined;
    return {
      id: str(c.Id) ?? "",
      name: (str((c.Names as string[] | undefined)?.[0]) ?? "").replace(/^\//, ""),
      state,
      status,
      image: str(c.Image),
      ports,
      abnormal,
    };
  });
}

async function endpointId(base: string, headers: Record<string, string>): Promise<number> {
  const res = await outboundRequest(`${base}/api/endpoints`, {
    headers,
    timeoutMs: TIMEOUT_MS,
    maxBytes: 500_000,
    allowPrivate: true,
  });
  if (res.status >= 400) throw new Error(`portainer API HTTP ${res.status}`);
  const eps = JSON.parse(res.text) as Array<Record<string, unknown>>;
  const id = eps[0]?.Id;
  if (typeof id !== "number") throw new Error("无可用环境（endpoints 为空）");
  return id;
}

export const portainerContainersConnector: WidgetConnector = {
  type: "portainer-containers",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<PortainerContainersData> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "portainer") throw new Error(`容器清单需要 Portainer 连接（当前：${row.kind}）`);
    const rawConfig = loadSourceConfig(row.configJson);
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const headers = { "X-API-Key": str(config.apiToken) ?? "" };

    const epId = await endpointId(base, headers);
    const res = await outboundRequest(`${base}/api/endpoints/${epId}/docker/containers/json?all=1`, {
      headers,
      timeoutMs: TIMEOUT_MS,
      maxBytes: 2_000_000,
      allowPrivate: true,
    });
    if (res.status >= 400) throw new Error(`portainer API HTTP ${res.status}`);
    return { containers: normalizePortainerContainers(JSON.parse(res.text)) };
  },
};

/** 容器日志尾部（只读；点行时按需取）。 */
export const portainerLogsConnector: WidgetConnector = {
  type: "portainer-logs",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<{ logs: string }> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    const containerId = typeof query.config.containerId === "string" ? query.config.containerId : "";
    if (!sourceId || !containerId) throw new Error("缺少数据连接或容器");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    const rawConfig = loadSourceConfig(row.configJson);
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    const headers = { "X-API-Key": str(config.apiToken) ?? "" };
    const epId = await endpointId(base, headers);
    const res = await outboundRequest(
      `${base}/api/endpoints/${epId}/docker/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=80`,
      { headers, timeoutMs: TIMEOUT_MS, maxBytes: 300_000, allowPrivate: true },
    );
    if (res.status >= 400) throw new Error(`容器日志 HTTP ${res.status}`);
    // SRV-20：按 Docker 复用帧格式真解析（原控制字符正则启发式会残留帧头乱码、误删正文控制字符）
    const text = demuxDockerLog(res.bytes).trim();
    return { logs: text.slice(-8000) || "(无输出)" };
  },
};

/** 去 ANSI 转义与残留控制字符（保留 `\n`/`\t`），仅作用于**展示层**文本。 */
/* oxlint-disable no-control-regex -- 有意：日志展示层剥离 ANSI/控制字符 */
function cleanLogText(s: string): string {
  return s
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
/* oxlint-enable no-control-regex */

/**
 * Docker 日志流解帧（**SRV-20**）。
 * TTY=false 时流是复用帧：`[streamType u8][0,0,0][len u32-be][payload]`；
 * TTY=true 时是 raw 文本（无帧头）。按帧解析，任一帧不合法即整段回落原文解码（保守）。
 * 原实现用 `replace(/[\x00-\x08\x0b-\x1f]{1,8}/g, "")` 启发式剥帧头：长度低位字节
 * ≥0x20 时是可打印字符、不被正则命中 → 残留成日志行首乱码；同时误删正文控制字符。
 */
export function demuxDockerLog(bytes: Uint8Array): string {
  const decode = (b: Uint8Array): string => cleanLogText(new TextDecoder().decode(b));
  if (bytes.length === 0) return "";
  const parts: Uint8Array[] = [];
  let off = 0;
  while (off < bytes.length) {
    if (off + 8 > bytes.length) return decode(bytes); // 尾部残缺 → raw（保守）
    const type = bytes[off]!;
    const padOk = bytes[off + 1] === 0 && bytes[off + 2] === 0 && bytes[off + 3] === 0;
    const len = (((bytes[off + 4]! << 24) | (bytes[off + 5]! << 16) | (bytes[off + 6]! << 8) | bytes[off + 7]!) >>> 0);
    if (!padOk || type > 2 || off + 8 + len > bytes.length) return decode(bytes);
    parts.push(bytes.subarray(off + 8, off + 8 + len));
    off += 8 + len;
  }
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    joined.set(part, o);
    o += part.length;
  }
  return cleanLogText(new TextDecoder().decode(joined));
}
