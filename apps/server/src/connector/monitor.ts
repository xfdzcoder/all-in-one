import type { WidgetConnector, WidgetDataQuery, FetchContext } from "./registry.ts";
import { num } from "./normalize.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * 监控源适配器（FR：服务器监控 · **D36 打通第三方服务，只做连接与展示**）。
 * v1 = Glances（`glances -w` REST API v4）：quicklook/load/fs/uptime/version，
 * 归一化为 MonitorMetrics；后续可增补其它源（node-exporter/Netdata…）。
 * 目标为本机/内网监控服务（服务聚合核心场景）→ allowPrivate 通道（D22 同族，
 * 同 app-launcher）；认证支持 none/basic/bearer（口令/令牌来自凭证库）。
 */

export interface MonitorMetrics {
  probe: { ok: boolean; source: string; version?: string; error?: string };
  cpuName?: string;
  cores?: number;
  cpu?: { percent: number };
  mem?: { percent: number; usedBytes?: number; totalBytes?: number };
  load?: { min1?: number; min5?: number; min15?: number };
  uptime?: string;
  disks: Array<{ point: string; percent: number; usedBytes?: number; totalBytes?: number }>;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 1_000_000;

async function fetchJson(base: string, path: string, headers: Record<string, string>): Promise<unknown> {
  const res = await outboundRequest(`${base}${path}`, {
    headers,
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    allowPrivate: true, // D36：监控源即本机/内网服务（服务聚合族）
  });
  if (res.status >= 400) throw new Error(`monitor API HTTP ${res.status}`);
  return res.text ? JSON.parse(res.text) : null;
}

/** Glances uptime 形态兼容（字符串 / JSON 字符串 / 对象）。 */
function parseUptime(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    try {
      const inner = JSON.parse(raw);
      return typeof inner === "string" ? inner : raw;
    } catch {
      return raw;
    }
  }
  if (raw && typeof raw === "object" && typeof (raw as { uptime?: unknown }).uptime === "string") {
    return (raw as { uptime: string }).uptime;
  }
  return undefined;
}

export function normalizeGlances(parts: {
  quicklook?: unknown;
  load?: unknown;
  mem?: unknown;
  fs?: unknown;
  uptime?: unknown;
  version?: unknown;
}): MonitorMetrics {
  const ql = (parts.quicklook ?? {}) as Record<string, unknown>;
  const load = (parts.load ?? {}) as Record<string, unknown>;
  const mem = (parts.mem ?? {}) as Record<string, unknown>;
  const out: MonitorMetrics = { probe: { ok: true, source: "glances" }, disks: [] };

  const cpuPct = num(ql.cpu);
  if (cpuPct !== undefined) out.cpu = { percent: cpuPct };
  out.cpuName = typeof ql.cpu_name === "string" ? ql.cpu_name : undefined;
  out.cores = num(ql.cpu_log_core) ?? num(ql.cpu_phys_core) ?? num(load.cpucore);

  const memPct = num(ql.mem) ?? num(mem.percent);
  if (memPct !== undefined) {
    out.mem = { percent: memPct, usedBytes: num(mem.used), totalBytes: num(mem.total) };
  }

  const min1 = num(load.min1) ?? num(ql.load);
  const min5 = num(load.min5);
  const min15 = num(load.min15);
  if (min1 !== undefined || min5 !== undefined || min15 !== undefined) {
    out.load = { min1, min5, min15 };
  }

  const uptime = parseUptime(parts.uptime);
  if (uptime) out.uptime = uptime;

  const version = parseUptime(parts.version) ?? (typeof parts.version === "string" ? parts.version : undefined);
  if (version) out.probe.version = version;

  // Q37（二.6）：容器化 Glances 的 /fs 常含同卷多条 bind mount（/etc/hosts、/usr/lib/os-release…）
  // → 同物理卷（device+size+used）只显示一行；代表挂载点取深度最浅者，若仍像文件挂载则回退设备名。
  const fsList = Array.isArray(parts.fs) ? parts.fs : [];
  const groups = new Map<
    string,
    { mnt: string; device: string; percent: number; usedBytes?: number; totalBytes?: number }
  >();
  for (const d of fsList) {
    const r = (d ?? {}) as Record<string, unknown>;
    const mnt = typeof r.mnt_point === "string" ? r.mnt_point : "";
    if (!mnt) continue;
    const device = typeof r.device_name === "string" ? r.device_name : "";
    const usedBytes = num(r.used);
    const totalBytes = num(r.size);
    const key = `${device}|${totalBytes ?? ""}|${usedBytes ?? ""}`;
    const row = { mnt, device, percent: num(r.percent) ?? 0, usedBytes, totalBytes };
    const cur = groups.get(key);
    if (!cur) {
      groups.set(key, row);
    } else if (mntDepth(row.mnt) < mntDepth(cur.mnt) || (mntDepth(row.mnt) === mntDepth(cur.mnt) && row.mnt.length < cur.mnt.length)) {
      groups.set(key, row);
    }
  }
  out.disks = [...groups.values()]
    .map((g) => ({
      point: diskLabel(g.mnt, g.device),
      percent: g.percent,
      usedBytes: g.usedBytes,
      totalBytes: g.totalBytes,
    }))
    .toSorted((a, b) => b.percent - a.percent);
  return out;
}

/** 挂载点深度（"/" = 0，"/backup" = 1，"/etc/hosts" = 2）。 */
function mntDepth(mnt: string): number {
  return mnt.split("/").filter(Boolean).length;
}

/** 存储行标签：像真实挂载点（深度 ≤ 1）用挂载点，否则回退设备名（去掉 /dev/ 前缀）。 */
function diskLabel(mnt: string, device: string): string {
  if (mntDepth(mnt) <= 1) return mnt;
  if (!device) return mnt;
  return device.replace(/^\/dev\//, "").split("/").pop() ?? device;
}

function authHeaders(config: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  const mode = typeof config.authMode === "string" ? config.authMode : "none";
  // Q36：兼容旧连接的 password 键（新键 apiToken 与组件/表单一致）
  const token = typeof config.apiToken === "string" ? config.apiToken : typeof config.password === "string" ? config.password : "";
  const username = typeof config.username === "string" ? config.username : "";
  if (mode === "bearer" && token) headers.Authorization = `Bearer ${token}`;
  else if (mode === "basic" && token) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  }
  return headers;
}

export const monitorConnector: WidgetConnector = {
  type: "monitor",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<MonitorMetrics> {
    const config = await resolveSecretRefs(query.config, ctx);
    const base = String(config.url ?? "").replace(/\/+$/, "");
    if (!base) {
      return { probe: { ok: false, source: "glances", error: "未配置监控源地址" }, disks: [] };
    }
    const headers = authHeaders(config);

    // 各插件端点 best-effort：单个失败不拖垮整卡（extras 逐步扩充）
    const [quicklook, load, mem, fs, uptime, version] = await Promise.all(
      (["quicklook", "load", "mem", "fs", "uptime", "version"] as const).map((p) =>
        fetchJson(base, `/api/4/${p}`, headers).catch(() => undefined),
      ),
    );

    if (quicklook === undefined && load === undefined && mem === undefined && fs === undefined) {
      return {
        probe: { ok: false, source: "glances", error: "监控源不可达或非 Glances API（/api/4/*）" },
        disks: [],
      };
    }
    const metrics = normalizeGlances({ quicklook, load, mem, fs, uptime, version });
    // 形状校验（D36/D32 哲学：API 漂移/非 Glances 源显式提示，不空白）
    const shapeless =
      metrics.cpu === undefined && metrics.mem === undefined && metrics.load === undefined && metrics.disks.length === 0;
    if (shapeless) {
      return {
        probe: { ok: false, source: "glances", error: "响应形状不符（非 Glances API /api/4/*）" },
        disks: [],
      };
    }
    return metrics;
  },
};
