import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs , mapLimit } from "./registry.ts";
import { imageMimeOf, imageSize } from "./image-size.ts";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑（网格）。
 * - 封面**服务端代取**（`getCoverArt.view` 需 Subsonic 认证参数）→ data URI（SEC3）；
 * - 列表 `getAlbumList2?type=newest`（或选了艺人时 `getArtist.view?id=`，见 Q94/反馈③）；
 *   **Q94（反馈②）**：「正在播放」已按用户要求移除，不再请求 `getNowPlaying`。
 * - 只读边界（D50 / **D54**）：无播放控制/收藏等写操作 —— 播放遥控（FR-X3e）已于 D54 移除，组件纯只读。
 *
 * **Q70 真机实测（2026-10-01，Navidrome 0.58）**：
 * - `getCoverArt.view` **不带 `size` 时返回原图**，实测 69KB–**8.5MB**；14 张里 5 张超 300KB 被丢，
 *   正是用户报的 `response too large (> 300000 bytes)`。
 * - `size=600` → 22–625KB；`size=300` → 14–159KB（全通过）。
 * - 因此：主取 `size=600`（放大预览够用），超限回落 `size=300`；仍失败则**占位不丢格**。
 */

export interface NavidromeAlbumItem {
  id: string;
  name: string;
  artist?: string;
  /** 封面 data URI（mime 按字节头，QA-001）；**空字符串 = 封面不可用**（组件渲染占位块，不丢格子）。 */
  cover: string;
  /** 封面**原始宽高**（D60 §1 字节头解析），供前端等比装箱；解析不出则缺省，前端按 1:1 退化。 */
  width?: number;
  height?: number;
}

export interface NavidromePlayingItem {
  title: string;
  artist?: string;
  username?: string;
}

export interface NavidromeLibraryData {
  albums: NavidromeAlbumItem[];
  /** Q94（反馈②）：「正在播放」已按用户要求移除（两处：服务概览 + 本专辑墙）。 */
  notes?: string[];
}

// SRV-29：并发上限与总时间预算（封面批量抓取）
const COVER_CONCURRENCY = 8;
const FETCH_BUDGET_MS = 20_000;

const TIMEOUT_MS = 8000;
/** Q70：主取 size=600（不带 size 会拿原图，实测最大 8.5MB）。 */
const COVER_SIZE = 600;
const COVER_MAX_BYTES = 1_000_000;
/** Q70：超限二级回落 size=300（实测全部 ≤159KB）。 */
const COVER_FALLBACK_SIZE = 300;
const COVER_FALLBACK_MAX_BYTES = 400_000;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function sr(x: unknown): Record<string, unknown> {
  return (((x ?? {}) as Record<string, unknown>)["subsonic-response"] ?? {}) as Record<string, unknown>;
}

/** 从 Subsonic 响应取专辑列表：`albumList2.album`（getAlbumList2）或 `artist.album`（getArtist）。
 *  **Q94（反馈③）**：Navidrome 未实现 `getAlbumList2?type=byArtist`，选中艺人时改走 `getArtist.view`，
 *  两种形状都要认（否则静默取到 0 项）。 */
function extractAlbumList(resp: unknown): Array<Record<string, unknown>> {
  const r = sr(resp);
  const fromList = (r.albumList2 as Record<string, unknown> | undefined)?.album;
  if (Array.isArray(fromList)) return fromList as Array<Record<string, unknown>>;
  const fromArtist = (r.artist as Record<string, unknown> | undefined)?.album;
  return Array.isArray(fromArtist) ? (fromArtist as Array<Record<string, unknown>>) : [];
}

/** 归一：getAlbumList2 条目 + 封面字节（可单测）。
 *  Q94（反馈②）：「正在播放」已移除，故不再接收/返回该部分。 */
export function normalizeNavidromeLibrary(
  newest: unknown,
  covers: Map<string, Uint8Array>,
): { albums: NavidromeAlbumItem[] } {
  const list: Array<Record<string, unknown>> = extractAlbumList(newest);
  const albums: NavidromeAlbumItem[] = [];
  for (const a of list) {
    const id = str(a.id) ?? str(a.coverArt);
    if (!id) continue;
    // Q70：封面缺失的专辑**仍保留**（cover = ""），由组件渲染占位块 —— 避免网格缺格
    const bytes = covers.get(id);
    // D60 §1：宽高从**字节头**解析（不依赖 Navidrome 元数据）—— 封面字节已抓到手，零额外请求
    const size = imageSize(bytes);
    albums.push({
      id,
      name: str(a.name) ?? "(未命名专辑)",
      artist: str(a.artist),
      cover: bytes && bytes.byteLength > 0 ? `data:${imageMimeOf(bytes)};base64,${Buffer.from(bytes).toString("base64")}` : "",
      ...(size ? { width: size.width, height: size.height } : {}),
    });
  }
  return { albums };
}

/** Subsonic 认证（salt+md5，口令不入 URL 日志）。 */
async function subsonicAuth(config: Record<string, unknown>): Promise<string> {
  const user = str(config.username) ?? "";
  const pass = str(config.password) ?? "";
  const salt = Math.random().toString(36).slice(2, 10);
  const token = await import("node:crypto").then((c) => c.createHash("md5").update(pass + salt).digest("hex"));
  return `u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=all-in-one&f=json`;
}

/** Q72/D57：**艺人清单**（配置表单「只看某艺人」的选项源，随 sourceId 变化）。
 *  Subsonic `getArtists`（**Navidrome 0.58 无 getArtists2，实测 404**）→ `artists.artist[]` 或 `artists.index[].artist[]`。形状直接是 select 选项。 */
export const navidromeArtistsConnector: WidgetConnector = {
  type: "navidrome-artists",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<{ items: Array<{ value: string; label: string }> }> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "navidrome") throw new Error(`艺人清单需要 Navidrome 连接（当前：${row.kind}）`);
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const auth = await subsonicAuth(config);
    const res = await outboundRequest(`${base}/rest/getArtists.view?${auth}`, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: 5_000_000,
      allowPrivate: true,
    });
    if (res.status >= 400) throw new Error(`Navidrome 艺人接口 HTTP ${res.status}`);
    const artistsObj = sr(JSON.parse(res.text)).artists as Record<string, unknown> | undefined;
    // Subsonic 有两种形态：扁平 `artists.artist[]` 或分组 `artists.index[].artist[]`（Navidrome 两者都出现过）
    const idx = artistsObj?.index;
    const groups = Array.isArray(idx) ? (idx as Array<Record<string, unknown>>) : [];
    const flat = Array.isArray(artistsObj?.artist)
      ? (artistsObj.artist as Array<Record<string, unknown>>)
      : groups.flatMap((g) => (Array.isArray(g.artist) ? (g.artist as Array<Record<string, unknown>>) : []));
    return {
      items: flat
        .map((a) => ({ value: str(a.id) ?? "", label: str(a.name) ?? "(未知艺人)" }))
        .filter((x) => x.value),
    };
  },
};

export const navidromeLibraryConnector: WidgetConnector = {
  type: "navidrome-library",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<NavidromeLibraryData> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db
      .select()
      .from(dataSource)
      .where(eq(dataSource.id, sourceId))
      .limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "navidrome") throw new Error(`专辑墙需要 Navidrome 连接（当前：${row.kind}）`);
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const auth = await subsonicAuth(config);
    // Q88（项 10）：不再封顶 24（原先选 30/50 也只给 24）
    const limit = Math.min(Math.max(Number(query.config.limit) || 12, 1), 120);
    // Q72/Q94（反馈③）：只看某个艺人。
    // ⚠️ **Navidrome 未实现 `getAlbumList2?type=byArtist`** —— 实测（2026-10-02，0.58）
    // 返回 HTTP 200 + `{"code":0,"message":"type 'byArtist' not implemented"}`，于是静默取到 0 张。
    // 改用 `getArtist.view?id=<artistId>` → `artist.album[]`（实测可用，字段同 `albumList2.album`）。
    const artistId = str(query.config.artistId);
    const notes: string[] = [];

    let newest: unknown;
    try {
      const listPath = artistId
        ? `getArtist.view?id=${encodeURIComponent(artistId)}&${auth}`
        : `getAlbumList2?type=newest&size=${limit}&${auth}`;
      const res = await outboundRequest(`${base}/rest/${listPath}`, {
        timeoutMs: TIMEOUT_MS,
        maxBytes: 1_000_000,
        allowPrivate: true,
      });
      if (res.status >= 400) throw new Error(`subsonic API HTTP ${res.status}`);
      const parsed = JSON.parse(res.text) as Record<string, unknown>;
      // Q94（反馈③）：**必须检查 Subsonic 的业务状态**。HTTP 200 不代表成功 ——
      // `status: "failed"` 时若照常解析会静默拿到 0 项（D47 违规：把 API 报错伪装成「没有数据」）。
      const body = ((parsed ?? {})["subsonic-response"] ?? {}) as Record<string, unknown>;
      if (body.status === "failed") {
        const e = (body.error ?? {}) as { code?: number; message?: string };
        throw new Error(
          `Subsonic 报错（code ${e.code ?? "?"}）：${e.message ?? "未知"} —— 检查 Navidrome 版本是否支持该接口、或该艺人 id 是否有效`,
        );
      }
      newest = parsed;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Navidrome 列表获取失败", { cause: err });
    }


    const list: Array<Record<string, unknown>> = extractAlbumList(newest);
    const covers = new Map<string, Uint8Array>();
    // Q70：失败按原因聚合（原先每项一条刷屏）+ 二级回落 size=300
    const wanted = list.slice(0, limit);
    // Q88（项 10）：补不满要**说明原因**（而不是让用户以为是我们漏取）
    if (wanted.length < limit) {
      notes.push(
        `只取到 ${wanted.length} 张专辑封面，少于选中的 ${limit} —— ${artistId ? "所选艺人" : "曲库"}里没有更多了。若确应更多，检查艺人筛选或 Navidrome 的曲库扫描是否完成。`,
      );
    }
    const reasons = new Map<string, number>();
    let failCount = 0;
    // SRV-29：**小并发 + 总时间预算**（原先串行 for-await，且每张最多两次尝试）
    type CoverResult = { id?: string; bytes?: Uint8Array; fail?: string };
    const got = await mapLimit<Record<string, unknown>, CoverResult | null>(
      wanted,
      COVER_CONCURRENCY,
      async (a) => {
        const id = str(a.id) ?? str(a.coverArt);
        const coverArt = str(a.coverArt) ?? id;
        if (!coverArt) return null;
        const grab = async (size: number, maxBytes: number) => {
          const res = await outboundRequest(
            `${base}/rest/getCoverArt.view?id=${encodeURIComponent(coverArt)}&size=${size}&${auth}`,
            { timeoutMs: TIMEOUT_MS, maxBytes, allowPrivate: true },
          );
          if (res.status >= 400 || res.bytes.byteLength === 0) {
            const body = (res.text ?? "").slice(0, 120).replace(/\s+/g, " ").trim();
            throw new Error(body ? `HTTP ${res.status} · ${body}` : `HTTP ${res.status}`);
          }
          return res.bytes;
        };
        try {
          let bytes: Uint8Array;
          try {
            bytes = await grab(COVER_SIZE, COVER_MAX_BYTES);
          } catch {
            // 二级回落：更小的尺寸（实测 size=300 全部 ≤159KB）
            bytes = await grab(COVER_FALLBACK_SIZE, COVER_FALLBACK_MAX_BYTES);
          }
          return { id, bytes };
        } catch (err) {
          return { id, fail: err instanceof Error ? err.message : "未知错误" };
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
        reasons.set(r.fail, (reasons.get(r.fail) ?? 0) + 1);
      } else if (r.id && r.bytes) {
        covers.set(r.id, r.bytes);
      }
    }
    if (budgetSkip > 0) {
      failCount += budgetSkip;
      reasons.set("抓取超出时间预算（封面较多或上游较慢）", budgetSkip);
    }
    if (failCount > 0 && wanted.length > 0) {
      const [reason, n] = [...reasons.entries()].toSorted((x, y) => y[1] - x[1])[0];
      const fix = reason.includes("too large")
        ? "封面原图过大 —— 已自动回落小尺寸仍超限，可在 Navidrome 后台重跑「扫描/生成封面」或降低封面质量"
        : "检查 Navidrome 地址与账号权限（getCoverArt）";
      notes.push(
        `${failCount}/${wanted.length} 个封面不可用（${reason}${n > 1 ? ` ×${n}` : ""}）—— ${fix}；缺图的格子显示占位块，不再跳过`,
      );
    }

    return {
      ...normalizeNavidromeLibrary(newest, covers),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
