import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * Immich 照片墙（FR-X3 只读深度，**D50**）：最近照片网格。
 * - 缩略图**服务端代取**（`/api/assets/:id/thumbnail` 需 API Key）→ data URI 回给组件，
 *   凭证不进前端（SEC3）；出站仍走 SSRF 基线（SEC4，allowPrivate 同 D36 族）。
 * - 列表来源 `/api/search/metadata`（asset.read）：注意 `assets.total` 被 size 封顶（Q49 实测），
 *   本组件按 items 渲染，不做计数。
 * - 只读边界（D50）：无任何写操作（上传/删除/收藏均不在范围）。
 *
 * **Q70 真机实测（2026-10-01，Immich v3.2.2）**：
 * - `size=thumbnail` 对 IMAGE 全部 200（4–29KB）；对 **VIDEO 全部 404**（`Asset media not found`），
 *   且 `size=preview/fullsize` 同样 404、`size=original` 403（key 缺 asset.download）。
 *   根因是该实例**视频缩略图任务未生成**（VIDEO 资产 `thumbhash: null`，IMAGE 有 thumbhash）——
 *   属实例侧，不是本组件能修；故回落 `size=preview` **无益**（视频照样 404，图片反而放大 10 倍）。
 * - 因此：**失败项不再丢格子**（渲染占位块），note **聚合成一条**并带上真实响应体原因。
 */

export interface ImmichGalleryItem {
  id: string;
  /** 拍摄/创建时间（ISO），组件相对化展示。 */
  at: string;
  type: "IMAGE" | "VIDEO";
  /** 缩略图 data URI（image/jpeg;base64,…）；**空字符串 = 缩略图不可用**（组件渲染占位块，不丢格子）。 */
  thumb: string;
  /** 跳转 Immich Web 的相册页（新标签打开）。 */
  href: string;
}

export interface ImmichGalleryData {
  items: ImmichGalleryItem[];
  /** 诚实降级说明（08 §5）。 */
  notes?: string[];
}

const TIMEOUT_MS = 8000;
const THUMB_MAX_BYTES = 500_000; // 缩略图（thumb 尺寸）通常 < 50KB

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 归一：search/metadata 条目 + 缩略图字节 → 网格项（可单测）。
 *  **Q70**：缩略图缺失的项仍保留（`thumb: ""`），由组件渲染占位 —— 避免网格缺格。 */
export function normalizeImmichGallery(
  search: unknown,
  thumbs: Map<string, Uint8Array>,
  webBase: string,
): ImmichGalleryItem[] {
  const assets = ((search ?? {}) as Record<string, unknown>).assets as Record<string, unknown> | undefined;
  const items: Array<Record<string, unknown>> = Array.isArray(assets?.items)
    ? (assets.items as Array<Record<string, unknown>>)
    : [];
  const base = webBase.replace(/\/+$/, "");
  const out: ImmichGalleryItem[] = [];
  for (const a of items) {
    const id = str(a.id);
    if (!id) continue;
    const bytes = thumbs.get(id);
    out.push({
      id,
      at: str(a.takenAt) ?? str(a.createdAt) ?? "",
      type: a.type === "VIDEO" ? "VIDEO" : "IMAGE",
      thumb: bytes && bytes.byteLength > 0 ? `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` : "",
      href: `${base}/photos/${id}`,
    });
  }
  return out;
}

/** Q72/D57：**相册清单**（配置表单「只看某相册」的选项源，随 sourceId 变化）。
 *  形状直接是 select 选项 `{items:[{value,label}]}`，前端零转换。 */
export const immichAlbumsConnector: WidgetConnector = {
  type: "immich-albums",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<{ items: Array<{ value: string; label: string }> }> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "immich") throw new Error(`相册清单需要 Immich 连接（当前：${row.kind}）`);
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const res = await outboundRequest(`${base}/api/albums`, {
      headers: { "X-API-Key": str(config.apiKey) ?? "" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 2_000_000,
      allowPrivate: true,
    });
    if (res.status >= 400) throw new Error(`Immich 相册接口 HTTP ${res.status}`);
    const list = Array.isArray(JSON.parse(res.text)) ? (JSON.parse(res.text) as Array<Record<string, unknown>>) : [];
    return {
      items: list
        .map((a) => ({ value: str(a.id) ?? "", label: str(a.albumName) ?? str(a.albumName) ?? "(未命名相册)" }))
        .filter((x) => x.value),
    };
  },
};

export const immichGalleryConnector: WidgetConnector = {
  type: "immich-gallery",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<ImmichGalleryData> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db
      .select()
      .from(dataSource)
      .where(eq(dataSource.id, sourceId))
      .limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "immich") throw new Error(`照片墙需要 Immich 连接（当前：${row.kind}）`);
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const apiKey = { "X-API-Key": str(config.apiKey) ?? "" };

    const limit = Math.min(Math.max(Number(query.config.limit) || 12, 1), 24);
    // Q72：只看某个相册（配置项 albumId → search/metadata 的 albumIds 过滤）
    const albumId = str(query.config.albumId);
    const notes: string[] = [];

    let search: unknown;
    try {
      const res = await outboundRequest(`${base}/api/search/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiKey },
        body: JSON.stringify({
          page: 1,
          size: limit,
          sortField: "recent",
          sortOrder: "desc",
          ...(albumId ? { albumIds: [albumId] } : {}),
        }),
        timeoutMs: TIMEOUT_MS,
        maxBytes: 1_000_000,
        allowPrivate: true,
      });
      if (res.status >= 400) throw new Error(`service API HTTP ${res.status}`);
      search = JSON.parse(res.text);
    } catch (err) {
      // 列表失败 = 整卡失败（probe 语义由组件按 error 呈现）
      throw new Error(err instanceof Error ? err.message : "Immich 列表获取失败");
    }

    const assets = ((search ?? {}) as Record<string, unknown>).assets as Record<string, unknown> | undefined;
    const list: Array<Record<string, unknown>> = Array.isArray(assets?.items)
      ? (assets.items as Array<Record<string, unknown>>)
      : [];
    const thumbs = new Map<string, Uint8Array>();
    // Q70：失败按**原因聚合**成一条 note（原先每项一条刷屏），并统计视频占比
    const wanted = list.slice(0, limit);
    const reasons = new Map<string, number>();
    let failCount = 0;
    let failVideo = 0;
    for (const a of wanted) {
      const id = str(a.id);
      if (!id) continue;
      try {
        const res = await outboundRequest(`${base}/api/assets/${id}/thumbnail?size=thumbnail`, {
          headers: apiKey,
          timeoutMs: TIMEOUT_MS,
          maxBytes: THUMB_MAX_BYTES,
          allowPrivate: true,
        });
        if (res.status >= 400 || res.bytes.byteLength === 0) {
          // Q70：带出服务端真实响应体（只报 HTTP 码不利于定位，08 §5「原因」要具体）
          const body = (res.text ?? "").slice(0, 120).replace(/\s+/g, " ").trim();
          throw new Error(body ? `HTTP ${res.status} · ${body}` : `HTTP ${res.status}`);
        }
        thumbs.set(id, res.bytes);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "未知错误";
        failCount += 1;
        if (a.type === "VIDEO") failVideo += 1;
        reasons.set(raw, (reasons.get(raw) ?? 0) + 1);
      }
    }
    if (failCount > 0 && wanted.length > 0) {
      const [reason, n] = [...reasons.entries()].sort((x, y) => y[1] - x[1])[0];
      const fix = reason.includes("Missing required permission")
        ? "Immich 后台「账号设置 → API Keys」勾选 asset.view 权限"
        : reason.includes("Asset media not found")
          ? `Immich 尚未生成这些${failVideo > 0 ? "视频" : ""}的缩略图 —— 到后台「任务」执行「生成缩略图/预览」（或等后台任务跑完）后点刷新`
          : "检查 Immich 地址与 API Key 是否具备 asset.view 权限";
      notes.push(
        `${failCount}/${wanted.length} 个缩略图不可用（${reason}${n > 1 ? ` ×${n}` : ""}）—— ${fix}；缺图的格子显示占位块，不再跳过`,
      );
    }

    return {
      items: normalizeImmichGallery(search, thumbs, base),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
