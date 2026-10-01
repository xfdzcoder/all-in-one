import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { navidromeLibraryConnector, normalizeNavidromeLibrary } from "./navidrome-library.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q51 契约测试（Navidrome 专辑墙，FR-X3 只读深度 D50）。 */

describe("normalizeNavidromeLibrary（D50）", () => {
  it("专辑（**缺封面也进网格，cover 空 → 占位块，Q70**）+ 正在播放", () => {
    const newest = {
      "subsonic-response": {
        albumList2: {
          album: [
            { id: "al-1", name: "CHIN UP!", artist: "陈奕迅", coverArt: "al-1" },
            { id: "al-2", name: "无封面", artist: "X", coverArt: "al-2" },
          ],
        },
      },
    };
    const np = {
      "subsonic-response": { nowPlaying: { entry: [{ title: "曲A", artist: "甲", username: "u" }] } },
    };
    const covers = new Map<string, Uint8Array>([["al-1", new Uint8Array([1, 2])]]);
    const out = normalizeNavidromeLibrary(newest, np, covers);
    // Q70：两张都保留（原先 al-2 因缺封面被丢 → 网格缺格）
    expect(out.albums.map((a) => a.name)).toEqual(["CHIN UP!", "无封面"]);
    expect(out.albums[0].cover.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(out.albums[1].cover).toBe(""); // Q70：缺封面不丢项，组件渲染占位块
    expect(out.nowPlaying).toEqual([{ title: "曲A", artist: "甲", username: "u" }]);
  });

  it("空响应返回空数组", () => {
    expect(normalizeNavidromeLibrary({}, {}, new Map())).toEqual({ albums: [], nowPlaying: [] });
  });
});

describe("navidrome-library 数据通道（sourceId 派发 + 封面代取）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;
  /** Q70：记录封面请求的 size 参数，验证「主取 600 → 超限回落 300」 */
  let coverUrls: string[] = [];

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-ndl-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/rest/getAlbumList2")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            "subsonic-response": {
              albumList2: {
                album: [
                  { id: "al-9", name: "专辑九", artist: "艺人", coverArt: "al-9" },
                  // Q70：size=600 时超 1MB 上限 → 应自动回落 size=300
                  { id: "al-big", name: "大封面", artist: "艺人", coverArt: "al-big" },
                  // Q70：两级都失败 → 仍保留该项（cover 空 → 占位块）+ 聚合 note
                  { id: "al-none", name: "取不到封面", artist: "艺人", coverArt: "al-none" },
                ],
              },
            },
          }),
        );
      }
      if (url.startsWith("/rest/getNowPlaying")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ "subsonic-response": { nowPlaying: {} } }));
      }
      if (url.startsWith("/rest/getCoverArt")) {
        coverUrls.push(url.split("&").find((p) => p.startsWith("size=")) ?? "(no-size)");
        const wantSmall = url.includes("size=300");
        res.setHeader("Content-Type", "image/jpeg");
        if (url.includes("id=al-none")) return res.writeHead(404).end();
        // al-big 在 size=600 时返回 >1MB（触发上限）→ 回落 size=300 才成功
        const payload =
          url.includes("id=al-big") && !wantSmall ? Buffer.alloc(1_100_000, 1) : Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
        return res.end(payload);
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    mock?.close();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("派发 Navidrome 连接 → 封面 data URI；非 Navidrome 连接显式拒绝", async () => {
    coverUrls = [];
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "navidrome",
      name: "mock-nd",
      configJson: JSON.stringify({ url: base, username: "u", password: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const data = (await navidromeLibraryConnector.fetch(
      { type: "navidrome-library", config: { sourceId: id, limit: 6 } },
      ctx,
    )) as { albums: Array<{ id: string; cover: string }>; notes?: string[] };
    // Q70：三项全保留 —— al-big 走回落拿到封面，al-none 两级失败仍留格
    expect(data.albums.map((a) => a.id)).toEqual(["al-9", "al-big", "al-none"]);
    expect(data.albums[0].cover).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.albums[1].cover).toMatch(/^data:image\/jpeg;base64,/); // 回落成功
    expect(data.albums[2].cover).toBe(""); // 仍保留 → 组件渲染占位块
    // Q70：主取 size=600，超限回落 size=300（al-big 命中两级）
    expect(coverUrls.filter((u) => u === "size=600").length).toBe(3);
    expect(coverUrls.filter((u) => u === "size=300").length).toBe(2); // al-big 回落 + al-none 回落
    // Q70：note 聚合成一条，带真实原因 + 怎么修（08 §5）
    expect(data.notes).toHaveLength(1);
    expect(data.notes?.[0]).toContain("1/3 个封面不可用");
    expect(data.notes?.[0]).toContain("占位块");

    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "immich",
      name: "mock-immich-for-ndl",
      configJson: JSON.stringify({ url: base, apiKey: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      navidromeLibraryConnector.fetch({ type: "navidrome-library", config: { sourceId: wrongKind } }, ctx),
    ).rejects.toThrow("专辑墙需要 Navidrome 连接");
  });
});
