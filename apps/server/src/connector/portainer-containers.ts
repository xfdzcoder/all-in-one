import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

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

export interface PortainerContainersData {
  containers: PortainerContainerItem[];
  notes?: string[];
}

const TIMEOUT_MS = 8000;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

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
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
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
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    const headers = { "X-API-Key": str(config.apiToken) ?? "" };
    const epId = await endpointId(base, headers);
    const res = await outboundRequest(
      `${base}/api/endpoints/${epId}/docker/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=80`,
      { headers, timeoutMs: TIMEOUT_MS, maxBytes: 300_000, allowPrivate: true },
    );
    if (res.status >= 400) throw new Error(`容器日志 HTTP ${res.status}`);
    // Docker logs 流带 8 字节帧头，逐段剥掉后按行整理
    const text = res.text.replace(/[\x00-\x08\x0b-\x1f]{1,8}/g, "").trim();
    return { logs: text.slice(-8000) || "(无输出)" };
  },
};
