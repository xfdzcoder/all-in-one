import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { asRecord, asRecordArray, parseJson, str } from "./normalize.ts";
import { outboundRequest, resolveSecretRefs , mapLimit, loadSourceConfig } from "./registry.ts";
import { imageMimeOf, imageSize } from "./image-size.ts";

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
  /** 缩略图 data URI（mime 按字节头，QA-001）；**空字符串 = 缩略图不可用**（组件渲染占位块，不丢格子）。 */
  thumb: string;
  /** 跳转 Immich Web 的相册页（新标签打开）。 */
  href: string;
  /** 缩略图**原始宽高**（D60 §1 字节头解析），供前端等比装箱；解析不出则缺省，前端按 1:1 退化。 */
  width?: number;
  height?: number;
}

interface ImmichGalleryData {
  items: ImmichGalleryItem[];
  /** 诚实降级说明（08 §5）。 */
  notes?: string[];
}

// SRV-29：并发上限与总时间预算（缩略图批量抓取）
const THUMB_CONCURRENCY = 8;
const FETCH_BUDGET_MS = 20_000;

const TIMEOUT_MS = 8000;
const THUMB_MAX_BYTES = 500_000; // 缩略图（thumb 尺寸）通常 < 50KB

/** Q88（项 10）：翻页取数的单页条数与页数上限。
 *  页数封顶（≈360 候选）是**防打爆上游**的闸门，不是精度参数；导出供契约测试共用，避免两边漂移。 */
export const IMMICH_PAGE_SIZE = 60;
export const IMMICH_MAX_PAGES = 6;

/** 归一：search/metadata 的**已筛选条目** + 缩略图字节 → 网格项（可单测）。
 *  **Q70**：缩略图缺失的项仍保留（`thumb: ""`），由组件渲染占位 —— 避免网格缺格。
 *  **Q88（项 3）**：调用方已滤掉视频，故此处不再保留 `type === "VIDEO"` 的项。 */
export function normalizeImmichGallery(
  assets: Array<Record<string, unknown>>,
  thumbs: Map<string, Uint8Array>,
  webBase: string,
): ImmichGalleryItem[] {
  const base = webBase.replace(/\/+$/, "");
  const out: ImmichGalleryItem[] = [];
  for (const a of assets) {
    const id = str(a.id);
    if (!id) continue;
    const bytes = thumbs.get(id);
    // D60 §1：宽高从**字节头**解析（不依赖 Immich 是否给 exif）—— 缩略图字节已抓到手，零额外请求
    const size = imageSize(bytes);
    out.push({
      id,
      at: str(a.takenAt) ?? str(a.createdAt) ?? "",
      type: a.type === "VIDEO" ? "VIDEO" : "IMAGE",
      thumb: bytes && bytes.byteLength > 0 ? `data:${imageMimeOf(bytes)};base64,${Buffer.from(bytes).toString("base64")}` : "",
      href: `${base}/photos/${id}`,
      ...(size ? { width: size.width, height: size.height } : {}),
    });
  }
  return out;
}

/** Q105（用户反馈④，2026-10-02）：灯箱**预览大图**（点开时按需取一张，不进墙的批量取数）。
 *  真机实测（Immich v3.2.2）：墙用 `size=thumbnail` 仅 **444×250 webp（11–25KB）** —— 灯箱按
 *  原始像素呈现即「太小」；`size=preview` **2560×1440 JPEG（326–589KB）**，撑满可用区域。
 *  preview 404（视频/预览任务未生成）→ **回落 thumbnail 并标 `fallback`**（组件继续显示图，
 *  并提示到 Immich 看原片）；两级都失败才抛错（原因 + 怎么修，D47）。 */
export interface ImmichPreviewData {
  /** data URI（mime 按字节头，QA-001）。 */
  src: string;
  /** true = preview 不可得，已回落缩略图。 */
  fallback: boolean;
  /** 原始宽高（字节头解析，D60 §1）。 */
  width?: number;
  height?: number;
}

/** preview 尺寸上限（真机实测最大 589KB；含余量防超大 JPEG 被截断）。 */
const PREVIEW_MAX_BYTES = 2_500_000;

export const immichPreviewConnector: WidgetConnector = {
  type: "immich-preview",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<ImmichPreviewData> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    const assetId = typeof query.config.assetId === "string" ? query.config.assetId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    if (!assetId) throw new Error("缺少照片 id");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "immich") throw new Error(`预览大图需要 Immich 连接（当前：${row.kind}）`);
    const rawConfig = loadSourceConfig(row.configJson);
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const apiKey = { "X-API-Key": str(config.apiKey) ?? "" };

    const grab = async (size: "preview" | "thumbnail") => {
      const res = await outboundRequest(`${base}/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`, {
        headers: apiKey,
        timeoutMs: TIMEOUT_MS,
        maxBytes: size === "preview" ? PREVIEW_MAX_BYTES : THUMB_MAX_BYTES,
        allowPrivate: true,
      });
      const body = (res.text ?? "").slice(0, 120).replace(/\s+/g, " ").trim();
      if (res.status >= 400 || res.bytes.byteLength === 0) {
        throw new Error(body ? `HTTP ${res.status} · ${body}` : `HTTP ${res.status}`);
      }
      return res.bytes;
    };

    let bytes: Uint8Array;
    let fallback = false;
    try {
      bytes = await grab("preview");
    } catch (previewErr) {
      try {
        bytes = await grab("thumbnail");
        fallback = true;
      } catch (thumbErr) {
        throw new Error(
          `预览大图与缩略图都取不到（preview：${previewErr instanceof Error ? previewErr.message : "未知"}；thumbnail：${thumbErr instanceof Error ? thumbErr.message : "未知"}）—— 检查 API Key 是否具备 asset.view 权限，或到 Immich 后台「任务」生成缩略图/预览后重试`,
          { cause: thumbErr },
        );
      }
    }
    const size = imageSize(bytes);
    return {
      src: `data:${imageMimeOf(bytes)};base64,${Buffer.from(bytes).toString("base64")}`,
      fallback,
      ...(size ? { width: size.width, height: size.height } : {}),
    };
  },
};

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
    const rawConfig = loadSourceConfig(row.configJson);
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
    // SRV-25：解析 + 形状收窄一步（原双次 JSON.parse + `as Array<…>` 断言）
    const albumsRaw = parseJson(res.text);
    if (albumsRaw === undefined) throw new Error("Immich 相册接口返回的不是合法 JSON —— 检查连接地址与认证");
    const list = asRecordArray(albumsRaw) ?? [];
    return {
      items: list
        // SRV-18：原 `?? str(a.albumName)` 是复制笔误（同表达式 ?? 两次），第二顺位应为 description
        .map((a) => ({ value: str(a.id) ?? "", label: str(a.albumName) ?? str(a.description) ?? "(未命名相册)" }))
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
    const rawConfig = loadSourceConfig(row.configJson);
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const apiKey = { "X-API-Key": str(config.apiKey) ?? "" };

    // Q88（项 3/10）：目标张数不再封顶 24（原先选 30/50 也只给 24）。
    // 因为要**滤掉视频后仍补足**，必须按页累加，故上限放宽到 120。
    const want = Math.min(Math.max(Number(query.config.limit) || 12, 1), 120);
    // Q72：只看某个相册（配置项 albumId → search/metadata 的 albumIds 过滤）
    const albumId = str(query.config.albumId);
    const notes: string[] = [];

    // 按页累加直到够数。单页 60、最多 6 页（≈360 候选）—— 页数封顶防止打爆上游。
    // 项 3 的视频过滤**只在本地做**：不同 Immich 版本对 `type` 过滤参数支持不一致，
    // 传错字段可能被 400；本地过滤是唯一跨版本可靠的口径。
    const picked: Array<Record<string, unknown>> = [];
    try {
      for (let page = 1; page <= IMMICH_MAX_PAGES && picked.length < want; page += 1) {
        const res = await outboundRequest(`${base}/api/search/metadata`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...apiKey },
          body: JSON.stringify({
            page,
            size: IMMICH_PAGE_SIZE,
            sortField: "recent",
            sortOrder: "desc",
            ...(albumId ? { albumIds: [albumId] } : {}),
          }),
          timeoutMs: TIMEOUT_MS,
          maxBytes: 1_500_000,
          allowPrivate: true,
        });
        if (res.status >= 400) throw new Error(`service API HTTP ${res.status}`);
        // SRV-25：顶层解析收窄 + 子访问走 asRecord/asRecordArray（原三级 `as` 断言）
        const parsed = asRecord(parseJson(res.text));
        if (!parsed) throw new Error("Immich 搜索接口返回的不是 JSON 对象 —— 检查连接地址与认证");
        const pageAssets = asRecord(parsed.assets);
        const pageItems = asRecordArray(pageAssets?.items) ?? [];
        for (const a of pageItems) {
          if (a.type === "VIDEO") continue; // 项 3：不展示视频
          if (str(a.id)) picked.push(a);
          if (picked.length >= want) break;
        }
        if (pageItems.length < IMMICH_PAGE_SIZE) break; // 没有下一页了
      }
    } catch (err) {
      // 列表失败 = 整卡失败（probe 语义由组件按 error 呈现）
      throw new Error(err instanceof Error ? err.message : "Immich 列表获取失败", { cause: err });
    }

    const wanted = picked.slice(0, want);
    // 项 10：补不满要**说明原因**（而不是让用户以为是我们漏取）
    if (wanted.length < want) {
      notes.push(
        `只取到 ${wanted.length} 张照片，少于选中的 ${want} —— ${albumId ? "所选相册" : "整个图库"}里没有更多了（已翻 ${IMMICH_MAX_PAGES} 页）。若确应更多，检查相册筛选或该账号的资产可见性。`,
      );
    }

    const thumbs = new Map<string, Uint8Array>();
    // Q70：失败按**原因聚合**成一条 note（原先每项一条刷屏），并统计视频占比
    const reasons = new Map<string, number>();
    let failCount = 0;
    let failVideo = 0;
    // SRV-29：**小并发 + 总时间预算**（原先串行 for-await，上游普遍超时时单个请求可挂十几分钟）
    type ThumbResult = { id: string; bytes?: Uint8Array; fail?: string; video?: boolean };
    const got = await mapLimit<Record<string, unknown>, ThumbResult | null>(
      wanted,
      THUMB_CONCURRENCY,
      async (a) => {
        const id = str(a.id);
        if (!id) return null;
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
          return { id, bytes: res.bytes, video: a.type === "VIDEO" };
        } catch (err) {
          return { id, fail: err instanceof Error ? err.message : "未知错误", video: a.type === "VIDEO" };
        }
      },
      { budgetMs: FETCH_BUDGET_MS },
    );
    let budgetSkip = 0;
    for (const r of got) {
      if (!r) {
        budgetSkip += 1;
        continue;
      }
      if (r.fail !== undefined) {
        failCount += 1;
        if (r.video) failVideo += 1;
        reasons.set(r.fail, (reasons.get(r.fail) ?? 0) + 1);
      } else if (r.bytes) {
        thumbs.set(r.id, r.bytes);
      }
    }
    if (budgetSkip > 0) {
      failCount += budgetSkip;
      reasons.set("抓取超出时间预算（缩略图较多或上游较慢）", budgetSkip);
    }
    if (failCount > 0 && wanted.length > 0) {
      const [reason, n] = [...reasons.entries()].toSorted((x, y) => y[1] - x[1])[0];
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
      items: normalizeImmichGallery(wanted, thumbs, base),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
