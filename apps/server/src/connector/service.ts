import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * 第三方服务概览适配器（Q39/D46 · D36 同族「只做连接与展示」）：
 * Immich / Navidrome / Portainer / Mihomo（metacubexd 为 Mihomo Web 前端，归 mihomo 类）。
 * v1 = 探活 + 版本 + 关键计数；深度组件（照片墙/播放/容器操作）属二期另立需求。
 */

export interface ServiceOverview {
  probe: { ok: boolean; source: string; version?: string; error?: string };
  /** 关键计数（各服务归一为标签+值，组件直接展示）。 */
  stats: Array<{ label: string; value: string }>;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 1_000_000;

async function getJson(base: string, path: string, headers: Record<string, string>): Promise<unknown> {
  const res = await outboundRequest(`${base}${path}`, {
    headers,
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    allowPrivate: true, // D36 族：服务即本机/内网
  });
  if (res.status >= 400) throw new Error(`service API HTTP ${res.status}`);
  return res.text ? JSON.parse(res.text) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Immich：/api/server/ping 探活，/api/server-info/version 取版本，/api/statistics 取计数。 */
export function normalizeImmich(parts: { version?: unknown; stats?: unknown }): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "immich" }, stats: [] };
  const v = parts.version as Record<string, unknown> | string | null;
  const version = typeof v === "string" ? v : str(((v ?? {}) as Record<string, unknown>).version);
  if (version) out.probe.version = version;
  const st = (parts.stats ?? {}) as Record<string, unknown>;
  const photos = num(st.photos) ?? num(st.photosCount);
  const videos = num(st.videos) ?? num(st.videosCount);
  if (photos !== undefined) out.stats.push({ label: "照片", value: String(photos) });
  if (videos !== undefined) out.stats.push({ label: "视频", value: String(videos) });
  const usage = num(st.usage);
  if (usage !== undefined) out.stats.push({ label: "占用", value: `${(usage / 2 ** 30).toFixed(1)} GB` });
  return out;
}

/** Navidrome（Subsonic）：ping.view 探活+版本，getStats（Navidrome 扩展）取计数（缺失即省略）。 */
export function normalizeNavidrome(parts: { ping?: unknown; stats?: unknown }): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "navidrome" }, stats: [] };
  const ping = ((parts.ping ?? {}) as Record<string, unknown>)["subsonic-response"] as
    | Record<string, unknown>
    | undefined;
  const version = str(ping?.version);
  if (version) out.probe.version = version;
  const st = ((parts.stats ?? {}) as Record<string, unknown>)["subsonic-response"] as
    | Record<string, unknown>
    | undefined;
  const inner = (st ?? {}) as Record<string, unknown>;
  for (const [key, label] of [
    ["songs", "歌曲"],
    ["albums", "专辑"],
    ["artists", "艺术家"],
  ] as const) {
    const n = num(inner[key]);
    if (n !== undefined) out.stats.push({ label, value: String(n) });
  }
  return out;
}

/** Portainer：/api/system/status 版本，/api/endpoints 端点数，容器计数。 */
export function normalizePortainer(parts: { status?: unknown; endpoints?: unknown; containers?: unknown }): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "portainer" }, stats: [] };
  const st = (parts.status ?? {}) as Record<string, unknown>;
  const version = str(st.Version) ?? str(st.version);
  if (version) out.probe.version = version;
  const eps = Array.isArray(parts.endpoints) ? (parts.endpoints as unknown[]).length : undefined;
  if (eps !== undefined) out.stats.push({ label: "端点", value: String(eps) });
  const containers = Array.isArray(parts.containers) ? (parts.containers as Array<Record<string, unknown>>) : [];
  if (parts.containers !== undefined) {
    const running = containers.filter((c) => str(c.State) === "running").length;
    out.stats.push({ label: "容器", value: `${running}/${containers.length} 运行中` });
  }
  return out;
}

/** Mihomo（含 metacubexd）：/version 版本，/proxies 代理数，/memory 占用。 */
export function normalizeMihomo(parts: { version?: unknown; proxies?: unknown; memory?: unknown }): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "mihomo" }, stats: [] };
  const versionRaw = parts.version;
  const version =
    typeof versionRaw === "string"
      ? versionRaw
      : str(((versionRaw ?? {}) as Record<string, unknown>).version);
  if (version) out.probe.version = version;
  const px = ((parts.proxies ?? {}) as Record<string, unknown>).proxies as Record<string, unknown> | undefined;
  if (px) out.stats.push({ label: "代理", value: String(Object.keys(px).length) });
  const mem = (parts.memory ?? {}) as Record<string, unknown>;
  const inuse = num(mem.inuse);
  if (inuse !== undefined) out.stats.push({ label: "内存", value: `${(inuse / 2 ** 20).toFixed(0)} MB` });
  return out;
}

/** Subsonic 认证：salt+md5(token)（口令不入 URL）。 */
async function subsonicAuth(config: Record<string, unknown>): Promise<string> {
  const user = str(config.username) ?? "";
  const pass = str(config.password) ?? "";
  const salt = Math.random().toString(36).slice(2, 10);
  const token = await import("node:crypto").then((c) => c.createHash("md5").update(pass + salt).digest("hex"));
  return `u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=all-in-one&f=json`;
}

export const serviceOverviewConnector: WidgetConnector = {
  type: "service-overview",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<unknown> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db
      .select()
      .from(dataSource)
      .where(eq(dataSource.id, sourceId))
      .limit(1);
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
    if (!base) throw new Error("连接缺少地址");

    try {
      switch (row.kind) {
        case "immich": {
          // 版本与计数接口随 Immich 版本演进 —— 逐个 best-effort，探活以 ping 为准
          await getJson(base, "/api/server/ping", { "X-API-Key": str(config.apiKey) ?? "" });
          let version: unknown;
          let stats: unknown;
          try {
            version = await getJson(base, "/api/server-info/version", { "X-API-Key": str(config.apiKey) ?? "" });
          } catch {
            /* 版本接口缺失则省略 */
          }
          try {
            stats = await getJson(base, "/api/statistics", { "X-API-Key": str(config.apiKey) ?? "" });
          } catch {
            /* 计数接口缺失则省略 */
          }
          return normalizeImmich({ version, stats });
        }
        case "navidrome": {
          const auth = await subsonicAuth(config);
          const ping = await getJson(base, `/rest/ping.view?${auth}`, {});
          let stats: unknown;
          try {
            stats = await getJson(base, `/rest/getStats.view?${auth}`, {});
          } catch {
            /* getStats 为 Navidrome 扩展，缺失则省略 */
          }
          return normalizeNavidrome({ ping, stats });
        }
        case "portainer": {
          const headers = { "X-API-Key": str(config.apiToken) ?? "" };
          const status = await getJson(base, "/api/system/status", headers);
          const endpoints = await getJson(base, "/api/endpoints", headers);
          let containers: unknown;
          const eps = Array.isArray(endpoints) ? (endpoints as Array<Record<string, unknown>>) : [];
          const epId = num(eps[0]?.Id);
          if (epId !== undefined) {
            try {
              containers = await getJson(base, `/api/endpoints/${epId}/docker/containers/json?all=1`, headers);
            } catch {
              /* 无 Docker 权限则省略容器计数 */
            }
          }
          return normalizePortainer({ status, endpoints, containers });
        }
        case "mihomo": {
          const headers = { Authorization: `Bearer ${str(config.secret) ?? ""}` };
          const version = await getJson(base, "/version", headers);
          const proxies = await getJson(base, "/proxies", headers);
          let memory: unknown;
          try {
            memory = await getJson(base, "/memory", headers);
          } catch {
            /* 可选 */
          }
          return normalizeMihomo({ version, proxies, memory });
        }
        default:
          throw new Error(`不支持的连接类型：${row.kind}`);
      }
    } catch (err) {
      return {
        probe: { ok: false, source: row.kind, error: err instanceof Error ? err.message : "fetch failed" },
        stats: [],
      } satisfies ServiceOverview;
    }
  },
};
