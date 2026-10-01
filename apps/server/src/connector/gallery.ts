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
 */

export interface ImmichGalleryItem {
  id: string;
  /** 拍摄/创建时间（ISO），组件相对化展示。 */
  at: string;
  type: "IMAGE" | "VIDEO";
  /** 缩略图 data URI（image/jpeg;base64,…）。 */
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

/** 归一：search/metadata 条目 + 缩略图字节 → 网格项（可单测）。 */
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
    if (!bytes || bytes.byteLength === 0) continue; // 缩略图失败的项不进网格（notes 记录）
    out.push({
      id,
      at: str(a.takenAt) ?? str(a.createdAt) ?? "",
      type: a.type === "VIDEO" ? "VIDEO" : "IMAGE",
      thumb: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
      href: `${base}/photos/${id}`,
    });
  }
  return out;
}

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
    const notes: string[] = [];

    let search: unknown;
    try {
      const res = await outboundRequest(`${base}/api/search/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiKey },
        body: JSON.stringify({ page: 1, size: limit, sortField: "recent", sortOrder: "desc" }),
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
    for (const a of list.slice(0, limit)) {
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
          // 403 时把服务端的权限名带出来（08 §5：原因 + 怎么修）
          const msg = res.status === 403 ? res.text.slice(0, 120) : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        thumbs.set(id, res.bytes);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "未知错误";
        const hint = raw.includes("Missing required permission")
          ? " —— Immich 后台「账号设置 → API Keys」勾选 asset.view 权限"
          : "";
        notes.push(`缩略图获取失败（${id.slice(0, 8)}）：${raw}${hint} —— 该项跳过`);
      }
    }

    return {
      items: normalizeImmichGallery(search, thumbs, base),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
