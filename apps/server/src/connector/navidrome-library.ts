import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑 + 正在播放。
 * - 封面**服务端代取**（`getCoverArt.view` 需 Subsonic 认证参数）→ data URI（SEC3）；
 * - 列表 `getAlbumList2?type=newest` + `getNowPlaying`（实测 0.58 可用）；
 * - 只读边界（D50）：无播放控制/收藏等写操作（播放遥控待拍板，FR-X3b）。
 */

export interface NavidromeAlbumItem {
  id: string;
  name: string;
  artist?: string;
  /** 封面 data URI（image/jpeg;base64,…）。 */
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
const COVER_MAX_BYTES = 300_000;

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
    const bytes = covers.get(id);
    if (!bytes || bytes.byteLength === 0) continue;
    albums.push({
      id,
      name: str(a.name) ?? "(未命名专辑)",
      artist: str(a.artist),
      cover: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
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
    for (const a of list.slice(0, limit)) {
      const id = str(a.id) ?? str(a.coverArt);
      const coverArt = str(a.coverArt) ?? id;
      if (!coverArt) continue;
      try {
        const res = await outboundRequest(`${base}/rest/getCoverArt.view?id=${encodeURIComponent(coverArt)}&${auth}`, {
          timeoutMs: TIMEOUT_MS,
          maxBytes: COVER_MAX_BYTES,
          allowPrivate: true,
        });
        if (res.status >= 400 || res.bytes.byteLength === 0) throw new Error(`HTTP ${res.status}`);
        if (id) covers.set(id, res.bytes);
      } catch (err) {
        notes.push(`封面获取失败（${(id ?? coverArt).slice(0, 8)}）：${err instanceof Error ? err.message : "未知错误"} —— 该项跳过`);
      }
    }

    return {
      ...normalizeNavidromeLibrary(newest, nowPlaying, covers),
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};
