import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import { emptyOverview, validateServiceOverview } from "@all-in-one/widget-sdk";
import type { ServiceListItem, ServiceOverview } from "@all-in-one/widget-sdk";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * 第三方服务概览适配器（Q39/D46 接入 · **Q44/D48 结构化重做**，指标按
 * `docs/feature-plan/research/00-service-metrics.md`「用户期望指标清单」取数）。
 *
 * 质量门禁（D47/08-widget-quality）：
 * - 指标从「用户问题」推导，多接口聚合 + 多版本路由回落；
 * - 取不到的指标进 `notes`（"原因 + 怎么修"），禁止"该服务未提供"甩锅文案；
 * - `sample` 只回本次采样点，趋势由客户端累积（D48）；速率类给累计量，前端差分。
 */

const TIMEOUT_MS = 5000;
const MAX_BYTES = 1_000_000;
const MAX_BYTES_LARGE = 5_000_000; // getArtists 等大响应

async function getJson(
  base: string,
  path: string,
  headers: Record<string, string>,
  maxBytes = MAX_BYTES,
): Promise<unknown> {
  const res = await outboundRequest(`${base}${path}`, {
    headers,
    timeoutMs: TIMEOUT_MS,
    maxBytes,
    allowPrivate: true, // D36 族：服务即本机/内网
  });
  if (res.status >= 400) throw new Error(`service API HTTP ${res.status}`);
  return res.text ? JSON.parse(res.text) : null;
}

async function postJson(
  base: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await outboundRequest(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    allowPrivate: true,
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

function gb(bytes: number): string {
  return `${(bytes / 2 ** 30).toFixed(1)} GB`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** 降级说明：区分"权限不足"与其它失败，给"原因 + 怎么修"（08 §5）。 */
function degradeNote(what: string, err: unknown, permissionHint?: string, genericHint?: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (permissionHint && (msg.includes("403") || msg.toLowerCase().includes("permission"))) {
    return `${what}获取失败（${msg}）—— ${permissionHint}`;
  }
  return `${what}获取失败（${msg}）—— ${genericHint ?? "检查该服务接口是否支持此指标、稍后重试；其余指标不受影响"}`;
}

/** Immich（实测 v3 路由 /api/server/*，旧版 /api/*；API Key 细粒度权限）。 */
export function normalizeImmich(parts: {
  version?: unknown;
  stats?: unknown;
  week?: unknown;
  recent?: unknown;
  errors?: Array<{ what: string; err: unknown }>;
}): ServiceOverview {
  const v = parts.version as Record<string, unknown> | string | null;
  const rawVersion = typeof v === "string" ? v : (v ?? {}) as Record<string, unknown>;
  const version =
    typeof rawVersion === "string"
      ? rawVersion
      : [num(rawVersion.major), num(rawVersion.minor), num(rawVersion.patch)].every((n) => n !== undefined)
        ? `${rawVersion.major}.${rawVersion.minor}.${rawVersion.patch}`
        : str(rawVersion.version);
  const out: ServiceOverview = {
    probe: { ok: true, source: "immich" },
    metrics: [],
  };
  if (version) out.probe.version = version;

  const st = (parts.stats ?? {}) as Record<string, unknown>;
  const photos = num(st.photos) ?? num(st.photosCount);
  const videos = num(st.videos) ?? num(st.videosCount);
  const usage = num(st.usage);
  const usagePhotos = num(st.usagePhotos);
  const usageVideos = num(st.usageVideos);

  if (photos !== undefined) {
    out.metrics.push({
      label: "照片",
      value: count(photos),
      emphasis: true,
      hint: usagePhotos !== undefined ? `占用 ${gb(usagePhotos)}` : undefined,
    });
  }
  if (videos !== undefined) {
    out.metrics.push({
      label: "视频",
      value: count(videos),
      hint: usageVideos !== undefined ? `占用 ${gb(usageVideos)}` : undefined,
    });
  }
  if (usage !== undefined) {
    out.metrics.push({ label: "存储占用", value: gb(usage) });
  }

  const byUser = Array.isArray(st.usageByUser) ? (st.usageByUser as Array<Record<string, unknown>>) : [];
  if (byUser.length > 0) {
    out.lists = [
      {
        title: "按用户",
        items: byUser.map((u) => ({
          title: str(u.userName) ?? str(u.userId) ?? "(未知用户)",
          detail: `照片 ${count(num(u.photos) ?? 0)} · 视频 ${count(num(u.videos) ?? 0)} · ${gb(num(u.usage) ?? 0)}`,
        })),
      },
    ];
    if (out.metrics.length > 0) {
      out.metrics.push({ label: "用户", value: String(byUser.length) });
    }
  }

  // Q49（用户已扩 asset.read）：近 7 天新增 + 最近上传清单
  // ⚠ 实测 search/metadata 的 assets.total 被 size 封顶 —— 计数以 items 数组 + nextPage 为准
  const weekAssets = ((parts.week ?? {}) as Record<string, unknown>).assets as Record<string, unknown> | undefined;
  if (weekAssets && Array.isArray(weekAssets.items)) {
    const n = weekAssets.items.length;
    out.metrics.push({
      label: "近 7 天新增",
      value: `${count(n)}${weekAssets.nextPage ? "+" : ""}`,
    });
  }
  const recentAssets = ((parts.recent ?? {}) as Record<string, unknown>).assets as Record<string, unknown> | undefined;
  const recentList: Array<Record<string, unknown>> = Array.isArray(recentAssets?.items)
    ? (recentAssets.items as Array<Record<string, unknown>>)
    : [];
  if (recentList.length > 0) {
    (out.lists ??= []).push({
      title: "最近上传",
      items: recentList.slice(0, 5).map((a) => ({
        title: str(a.originalFileName) ?? "(未命名)",
        detail: a.type === "VIDEO" ? "视频" : "照片",
        at: str(a.createdAt) ?? str(a.takenAt),
      })),
    });
  }

  for (const e of parts.errors ?? []) {
    (out.notes ??= []).push(
      degradeNote(e.what, e.err, "API Key 权限不足 —— Immich 后台「账号设置 → API Keys」勾选对应权限（如 server.statistics）"),
    );
  }
  return out;
}

/** Subsonic 响应壳（`subsonic-response`）；纯函数上提模块级（consistent-function-scoping）。 */
const sr = (x: unknown): Record<string, unknown> =>
  (((x ?? {}) as Record<string, unknown>)["subsonic-response"] ?? {}) as Record<string, unknown>;

/** Navidrome（Subsonic；实测 0.58 无 getStats → getScanStatus + getArtists 聚合）。 */
export function normalizeNavidrome(parts: {
  ping?: unknown;
  scanStatus?: unknown;
  artists?: unknown;
  newest?: unknown;
  errors?: Array<{ what: string; err: unknown }>;
}): ServiceOverview {
  const ping = sr(parts.ping);
  const out: ServiceOverview = { probe: { ok: true, source: "navidrome" }, metrics: [] };
  const version = str(ping.version) ?? str(ping.serverVersion);
  if (version) out.probe.version = version;

  // 曲库规模：曲目 = scanStatus.count（实测唯一权威来源）；专辑/艺术家 = getArtists 聚合
  const scan = sr(parts.scanStatus).scanStatus as Record<string, unknown> | undefined;
  const songs = scan ? num(scan.count) : undefined;
  const artistsResp = sr(parts.artists).artists as Record<string, unknown> | undefined;
  const artistList: Array<Record<string, unknown>> = artistsResp
    ? (artistsResp.artist ?? (artistsResp.index as Array<Record<string, unknown>> | undefined)?.flatMap((i) => (i.artist as Array<Record<string, unknown>>) ?? []) ?? []) as Array<Record<string, unknown>>
    : [];
  const albums = artistList.reduce((sum, a) => sum + (num(a.albumCount) ?? 0), 0);

  if (songs !== undefined) out.metrics.push({ label: "曲目", value: count(songs), emphasis: true });
  if (artistList.length > 0) {
    out.metrics.push({ label: "专辑", value: count(albums) });
    out.metrics.push({ label: "艺术家", value: String(artistList.length) });
  }

  const newest = (sr(parts.newest).albumList2 as Record<string, unknown> | undefined)?.album;
  const newestList: Array<Record<string, unknown>> = Array.isArray(newest) ? newest : [];
  const newestItems: ServiceListItem[] = newestList.slice(0, 4).map((a) => ({
    title: str(a.name) ?? "(未命名专辑)",
    detail: str(a.artist),
  }));
  // Q94（反馈②）：**去掉「正在播放」** —— 用户要求移除（绝大多数时间恒为「正在播放 / 暂无」，无信息量）
  out.lists = newestItems.length > 0 ? [{ title: "最近添加", items: newestItems }] : []; // unicorn(no-useless-spread)

  if (scan) {
    const scanning = scan.scanning === true;
    const lastScan = str(scan.lastScan);
    // Q84（项 7）：「库就绪」无信息量，用户要求去掉 —— 只在扫描进行中时才提示
    if (scanning) out.statuses = [{ tone: "info", text: "库扫描中" }];
    if (lastScan) out.metrics.push({ label: "上次扫描", value: new Date(lastScan).toLocaleString("zh-CN") });
  }

  for (const e of parts.errors ?? []) (out.notes ??= []).push(degradeNote(e.what, e.err));
  return out;
}

/** Portainer（实测 2.27.6；用户头号问题 = "我的容器都活着吗"）。 */
export function normalizePortainer(parts: {
  status?: unknown;
  endpoints?: unknown;
  containers?: unknown;
  info?: unknown;
  errors?: Array<{ what: string; err: unknown }>;
}): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "portainer" }, metrics: [] };
  const st = (parts.status ?? {}) as Record<string, unknown>;
  const version = str(st.Version) ?? str(st.version);
  if (version) out.probe.version = version;

  const eps = Array.isArray(parts.endpoints) ? (parts.endpoints as unknown[]).length : undefined;
  const containers = Array.isArray(parts.containers)
    ? (parts.containers as Array<Record<string, unknown>>)
    : undefined;
  const info = (parts.info ?? {}) as Record<string, unknown>;

  if (containers) {
    const running = containers.filter((c) => str(c.State) === "running");
    const abnormal = containers.filter((c) => {
      const state = str(c.State);
      if (state === "running" || state === "created" || state === "paused") return false;
      const status = str(c.Status) ?? "";
      // "Exited (0) …" 正常退出；非 0 / 其它状态视为异常
      const m = status.match(/Exited \((\d+)\)/);
      return !m || Number(m[1]) !== 0;
    });
    out.metrics.push({
      label: "容器运行",
      value: `${running.length}/${containers.length}`,
      emphasis: true,
      hint: abnormal.length > 0 ? `${abnormal.length} 个异常` : "全部正常",
    });
    if (eps !== undefined) out.metrics.push({ label: "环境", value: String(eps) });
    if (num(info.Images) !== undefined) out.metrics.push({ label: "镜像", value: String(info.Images) });
    if (num(info.NVolumes) !== undefined) out.metrics.push({ label: "卷", value: String(info.NVolumes) });
    if (num(info.NCPU) !== undefined && num(info.MemTotal) !== undefined) {
      out.metrics.push({
        label: "宿主",
        value: `${info.NCPU} 核 · ${gb(info.MemTotal as number)}`,
      });
    }

    out.statuses =
      abnormal.length > 0
        ? [{ tone: "error", text: `${abnormal.length} 个容器异常` }]
        : [{ tone: "ok", text: "全部容器正常" }];
    out.lists = [
      {
        title: abnormal.length > 0 ? "异常容器" : "容器状态",
        items: (abnormal.length > 0 ? abnormal : containers.slice(0, 6)).map((c) => ({
          title: (str((c.Names as string[] | undefined)?.[0]) ?? str(c.Id) ?? "").replace(/^\//, ""),
          detail: str(c.Status) ?? str(c.State),
          tone: abnormal.length > 0 ? ("error" as const) : ("ok" as const),
        })),
      },
    ];
  } else if (eps !== undefined) {
    out.metrics.push({ label: "环境", value: String(eps) });
  }

  for (const e of parts.errors ?? []) {
    (out.notes ??= []).push(
      degradeNote(e.what, e.err, "API Key 缺 Docker 权限 —— Portainer「用户 → API keys」使用管理员创建的密钥"),
    );
  }
  return out;
}

/** Mihomo（含 metacubexd 前端；实测 meta v1.19.31，/memory 与 /traffic 经反代不可用）。 */
export function normalizeMihomo(parts: {
  version?: unknown;
  proxies?: unknown;
  connections?: unknown;
  rules?: unknown;
  proxyProviders?: unknown;
  memory?: unknown;
  errors?: Array<{ what: string; err: unknown }>;
}): ServiceOverview {
  const out: ServiceOverview = { probe: { ok: true, source: "mihomo" }, metrics: [] };
  const versionRaw = parts.version as Record<string, unknown> | string | null;
  const version = typeof versionRaw === "string" ? versionRaw : str((versionRaw ?? {}).version);
  if (version) out.probe.version = version;

  const px = ((parts.proxies ?? {}) as Record<string, unknown>).proxies as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (px) {
    const groups = Object.entries(px).filter(([, v]) => Array.isArray(v.all) && v.now);
    const globalNow = str(px.GLOBAL?.now);
    out.metrics.push({
      label: "出口选择",
      value: globalNow ?? (groups[0] ? str(groups[0][1].now) ?? "—" : "—"),
      emphasis: true,
      hint: `${groups.length} 个策略组`,
    });
    out.metrics.push({ label: "节点/策略", value: String(Object.keys(px).length) });

    // Q69：「策略组选择」清单不再进概览卡 —— metacubexd Overview 也不放（策略组在 Proxies 页），
    // 该职责归「Mihomo 节点面板」组件；这里只保留「节点延迟」清单。
    // 最近延迟（history 尾点）
    const delays: ServiceListItem[] = groups
      .map(([name, v]): ServiceListItem | null => {
        const hist = Array.isArray(v.history) ? (v.history as Array<Record<string, unknown>>) : [];
        const last = hist[hist.length - 1];
        const delay = last ? num(last.delay) : undefined;
        return delay !== undefined
          ? { title: name, detail: `${delay} ms`, tone: delay < 300 ? "ok" : "warn" }
          : null;
      })
      .filter((x): x is ServiceListItem => x !== null);
    if (delays.length > 0) out.lists = [{ title: "节点延迟", items: delays }];
  }

  const conn = (parts.connections ?? {}) as Record<string, unknown>;
  const active = Array.isArray(conn.connections) ? conn.connections.length : undefined;
  const downTotal = num(conn.downloadTotal);
  const upTotal = num(conn.uploadTotal);
  if (active !== undefined) {
    out.metrics.push({ label: "活动连接", value: String(active) });
    out.sample = {
      at: new Date().toISOString(),
      series: {
        ...(active !== undefined ? { connections: active } : {}),
        ...(downTotal !== undefined ? { downTotal } : {}),
        ...(upTotal !== undefined ? { upTotal } : {}),
      },
    };
  }
  // Q69：累计流量拆成**两个独立块**（metacubexd Overview 亦分 Upload/Download Total），
  // 与「活动连接」同排构成「一行三个」。
  if (downTotal !== undefined) out.metrics.push({ label: "累计下行", value: gb(downTotal) });
  if (upTotal !== undefined) out.metrics.push({ label: "累计上行", value: gb(upTotal) });

  const rules = ((parts.rules ?? {}) as Record<string, unknown>).providers as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (rules) {
    const ruleCount = Object.values(rules).reduce((s, r) => s + (num(r.ruleCount) ?? 0), 0);
    if (ruleCount > 0) out.metrics.push({ label: "规则", value: String(ruleCount) });
  }
  const providers = ((parts.proxyProviders ?? {}) as Record<string, unknown>).providers as
    | Record<string, unknown>
    | undefined;
  if (providers && Object.keys(providers).length > 0) {
    out.metrics.push({ label: "订阅源", value: String(Object.keys(providers).length) });
  }

  const memInuse = num(((parts.memory ?? {}) as Record<string, unknown>).inuse);
  if (memInuse !== undefined) out.metrics.push({ label: "内存", value: `${(memInuse / 2 ** 20).toFixed(0)} MB` });

  for (const e of parts.errors ?? []) {
    // Q79：`/memory` 失败**静默丢弃** —— 诊断通道（diagnostics → 前端 console.error）已按
    // 用户拍板下线（原话「后面得移除的」）。内存是次指标，语义为「仅在能取到时渲染」
    // （research/01-mihomo-overview-metrics）：失败既不进卡片、也不再打控制台。
    if (e.what === "内存") continue;
    (out.notes ??= []).push(
      degradeNote(
        e.what,
        e.err,
        "API Key 缺权限 —— 检查 external-controller 密钥（mihomo external-controller 配置）",
        "若经反代部署，接口可能被缓冲或超时 —— 可直连 external-controller 或忽略该项",
      ),
    );
  }
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

    const errors: Array<{ what: string; err: unknown }> = [];
    const best = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        errors.push({ what, err });
        return undefined;
      }
    };

    let overview: ServiceOverview;
    try {
      switch (row.kind) {
      case "immich": {
        const apiKey = { "X-API-Key": str(config.apiKey) ?? "" };
        // 探活必须成功（否则整体 probe 失败）；版本/统计多路由回落
        await getJson(base, "/api/server/ping", apiKey);
        const version =
          (await best("版本", () => getJson(base, "/api/server/version", apiKey))) ??
          (await best("版本", () => getJson(base, "/api/server-info/version", apiKey)));
        const stats =
          (await best("统计", () => getJson(base, "/api/server/statistics", apiKey))) ??
          (await best("统计", () => getJson(base, "/api/statistics", apiKey)));
        // Q49：近 7 天新增 + 最近上传（search/metadata 需 asset.read 权限）
        const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const week = await best("近 7 天新增", () =>
          postJson(base, "/api/search/metadata", apiKey, { page: 1, size: 1000, takenAfter: weekAgo }),
        );
        const recent = await best("最近上传", () =>
          postJson(base, "/api/search/metadata", apiKey, { page: 1, size: 5, sortField: "recent", sortOrder: "desc" }),
        );
        overview = normalizeImmich({ version, stats, week, recent, errors });
        break;
      }
      case "navidrome": {
        const auth = await subsonicAuth(config);
        const ping = await getJson(base, `/rest/ping.view?${auth}`, {});
        const [scanStatus, artists, newest] = await Promise.all([
          best("扫描状态", () => getJson(base, `/rest/getScanStatus.view?${auth}`, {})),
          best("曲库统计", () => getJson(base, `/rest/getArtists.view?${auth}`, {}, MAX_BYTES_LARGE)),
          best("最近添加", () => getJson(base, `/rest/getAlbumList2?type=newest&size=4&${auth}`, {})),
        ]);
        // Q94（反馈②）：「正在播放」已按用户要求移除（含 getNowPlaying 取数），不再请求该接口
        overview = normalizeNavidrome({ ping, scanStatus, artists, newest, errors });
        break;
      }
      case "portainer": {
        const headers = { "X-API-Key": str(config.apiToken) ?? "" };
        const status = await getJson(base, "/api/system/status", headers);
        const endpoints = await getJson(base, "/api/endpoints", headers);
        const eps = Array.isArray(endpoints) ? (endpoints as Array<Record<string, unknown>>) : [];
        const epId = num(eps[0]?.Id);
        let containers: unknown;
        let info: unknown;
        if (epId !== undefined) {
          containers = await best("容器列表", () =>
            getJson(base, `/api/endpoints/${epId}/docker/containers/json?all=1`, headers),
          );
          info = await best("宿主信息", () => getJson(base, `/api/endpoints/${epId}/docker/info`, headers));
        }
        overview = normalizePortainer({ status, endpoints, containers, info, errors });
        break;
      }
      case "mihomo": {
        const headers = { Authorization: `Bearer ${str(config.secret) ?? ""}` };
        const version = await getJson(base, "/version", headers);
        const proxies = await getJson(base, "/proxies", headers);
        const [connections, rules, proxyProviders, memory] = await Promise.all([
          best("连接", () => getJson(base, "/connections", headers)),
          best("规则", () => getJson(base, "/providers/rules", headers)),
          best("订阅源", () => getJson(base, "/providers/proxies", headers)),
          best("内存", () => getJson(base, "/memory", headers)),
        ]);
        overview = normalizeMihomo({ version, proxies, connections, rules, proxyProviders, memory, errors });
        break;
      }
      default:
        throw new Error(`不支持的连接类型：${row.kind}`);
      }
    } catch (err) {
      // 探活失败（连不上/认证失败）→ probe 显式失败 + 诚实说明（不抛裸错）
      const msg = err instanceof Error ? err.message : String(err);
      return emptyOverview(row.kind, msg);
    }

    // 契约兜底：任何适配器输出都必须合法（含降级路径）
    const errs = validateServiceOverview(overview);
    if (errs.length > 0) return emptyOverview(row.kind, `适配器输出不符合契约：${errs.join("；")}`);
    return overview;
  },
};
