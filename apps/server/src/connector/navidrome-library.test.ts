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
  it("专辑（有封面才进网格）+ 正在播放", () => {
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
    expect(out.albums.map((a) => a.name)).toEqual(["CHIN UP!"]);
    expect(out.albums[0].cover.startsWith("data:image/jpeg;base64,")).toBe(true);
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
            "subsonic-response": { albumList2: { album: [{ id: "al-9", name: "专辑九", artist: "艺人", coverArt: "al-9" }] } },
          }),
        );
      }
      if (url.startsWith("/rest/getNowPlaying")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ "subsonic-response": { nowPlaying: {} } }));
      }
      if (url.startsWith("/rest/getCoverArt")) {
        res.setHeader("Content-Type", "image/jpeg");
        return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
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
    )) as { albums: Array<{ id: string; cover: string }> };
    expect(data.albums.map((a) => a.id)).toEqual(["al-9"]);
    expect(data.albums[0].cover).toMatch(/^data:image\/jpeg;base64,/);

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
