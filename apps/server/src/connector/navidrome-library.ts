import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑 + 正在播放。
 * - 封面**服务端代取**（`getCoverArt.view` 需 Subsonic 认证参数）→ data URI（SEC3）；
 * - 列表 `getAlbumList2?type=newest` + `getNowPlaying`（实测 0.58 可用）；
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
  /** 封面 data URI（image/jpeg;base64,…）；**空字符串 = 封面不可用**（组件渲染占位块，不丢格子）。 */
  cover: string;
}

export interface NavidromePlayingItem {
  title: string;
  artist?: string;
  username?: string;
}

export interface NavidromeLibraryData {
  albums: NavidromeAlbumItem[];
  nowPlaying: NavidromePlayingItem[];
  notes?: string[];
}

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

/** 归一：getAlbumList2/getNowPlaying 条目 + 封面字节（可单测）。 */
export function normalizeNavidromeLibrary(
  newest: unknown,
  nowPlaying: unknown,
  covers: Map<string, Uint8Array>,
): { albums: NavidromeAlbumItem[]; nowPlaying: NavidromePlayingItem[] } {
  const list: Array<Record<string, unknown>> = (() => {
    const a = (sr(newest).albumList2 as Record<string, unknown> | undefined)?.album;
    return Array.isArray(a) ? (a as Array<Record<string, unknown>>) : [];
  })();
  const albums: NavidromeAlbumItem[] = [];
  for (const a of list) {
    const id = str(a.id) ?? str(a.coverArt);
    if (!id) continue;
    // Q70：封面缺失的专辑**仍保留**（cover = ""），由组件渲染占位块 —— 避免网格缺格
    const bytes = covers.get(id);
    albums.push({
      id,
      name: str(a.name) ?? "(未命名专辑)",
      artist: str(a.artist),
      cover: bytes && bytes.byteLength > 0 ? `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` : "",
    });
  }
  const np = (sr(nowPlaying).nowPlaying as Record<string, unknown> | undefined)?.entry;
  const nowPlayingList: NavidromePlayingItem[] = (Array.isArray(np) ? (np as Array<Record<string, unknown>>) : []).map(
    (e) => ({
      title: str(e.title) ?? "(未知曲目)",
      artist: str(e.artist),
      username: str(e.username),
    }),
  );
  return { albums, nowPlaying: nowPlayingList };
}

/** Subsonic 认证（salt+md5，口令不入 URL 日志）。 */
async function subsonicAuth(config: Record<string, unknown>): Promise<string> {
  const user = str(config.username) ?? "";
  const pass = str(config.password) ?? "";
  const salt = Math.random().toString(36).slice(2, 10);
  const token = await import("node:crypto").then((c) => c.createHash("md5").update(pass + salt).digest("hex"));
  return `u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=all-in-one&f=json`;
}

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
    const limit = Math.min(Math.max(Number(query.config.limit) || 12, 1), 24);
    const notes: string[] = [];

    let newest: unknown;
    try {
      const res = await outboundRequest(`${base}/rest/getAlbumList2?type=newest&size=${limit}&${auth}`, {
        timeoutMs: TIMEOUT_MS,
        maxBytes: 1_000_000,
        allowPrivate: true,
      });
      if (res.status >= 400) throw new Error(`subsonic API HTTP ${res.status}`);
      newest = JSON.parse(res.text);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Navidrome 列表获取失败");
    }

    let nowPlaying: unknown = {};
    try {
      const res = await outboundRequest(`${base}/rest/getNowPlaying.view?${auth}`, {
        timeoutMs: TIMEOUT_MS,
        maxBytes: 200_000,
        allowPrivate: true,
      });
      if (res.status < 400) nowPlaying = JSON.parse(res.text);
    } catch (err) {
      notes.push(`正在播放获取失败：${err instanceof Error ? err.message : "未知错误"} —— 该项暂缺`);
    }

    const list: Array<Record<string, unknown>> = (() => {
      const a = (sr(newest).albumList2 as Record<string, unknown> | undefined)?.album;
      return Array.isArray(a) ? (a as Array<Record<string, unknown>>) : [];
    })();
    const covers = new Map<string, Uint8Array>();
    // Q70：失败按原因聚合（原先每项一条刷屏）+ 二级回落 size=300
    const wanted = list.slice(0, limit);
    const reasons = new Map<string, number>();
    let failCount = 0;
    for (const a of wanted) {
      const id = str(a.id) ?? str(a.coverArt);
      const coverArt = str(a.coverArt) ?? id;
      if (!coverArt) continue;
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
        if (id) covers.set(id, bytes);
      } catch (err) {
        failCount += 1;
        const raw = err instanceof Error ? err.message : "未知错误";
        reasons.set(raw, (reasons.get(raw) ?? 0) + 1);
      }
    }
    if (failCount > 0 && wanted.length > 0) {
      const [reason, n] = [...reasons.entries()].sort((x, y) => y[1] - x[1])[0];
      const fix = reason.includes("too large")
        ? "封面原图过大 —— 已自动回落小尺寸仍超限，可在 Navidrome 后台重跑「扫描/生成封面」或降低封面质量"
        : "检查 Navidrome 地址与账号权限（getCoverArt）";
      notes.push(
        `${failCount}/${wanted.length} 个封面不可用（${reason}${n > 1 ? ` ×${n}` : ""}）—— ${fix}；缺图的格子显示占位块，不再跳过`,
      );
    }

    return {
      ...normalizeNavidromeLibrary(newest, nowPlaying, covers),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
