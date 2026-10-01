import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { immichGalleryConnector, normalizeImmichGallery } from "./gallery.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q50 契约测试（Immich 照片墙，FR-X3 只读深度 D50）。 */

describe("normalizeImmichGallery（D50）", () => {
  const search = {
    assets: {
      items: [
        { id: "a1", type: "IMAGE", takenAt: "2026-09-26T02:27:30Z", originalFileName: "a.jpg" },
        { id: "a2", type: "VIDEO", createdAt: "2026-09-26T02:27:31Z" },
        { id: "a3", type: "IMAGE", createdAt: "2026-09-26T02:27:32Z" }, // 无缩略图 → 跳过
      ],
    },
  };

  it("缩略图 → data URI；无缩略图的项跳过；VIDEO 标记；href 指向 Immich Web", () => {
    const thumbs = new Map<string, Uint8Array>([
      ["a1", new Uint8Array([1, 2, 3])],
      ["a2", new Uint8Array([4, 5])],
    ]);
    const items = normalizeImmichGallery(search, thumbs, "https://immich.example/");
    expect(items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(items[0].thumb.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(items[0].at).toBe("2026-09-26T02:27:30Z"); // takenAt 优先
    expect(items[1].type).toBe("VIDEO");
    expect(items[1].href).toBe("https://immich.example/photos/a2");
  });

  it("空/畸形 search 返回空数组", () => {
    expect(normalizeImmichGallery({}, new Map(), "https://x")).toEqual([]);
    expect(normalizeImmichGallery({ assets: { items: "nope" } }, new Map(), "https://x")).toEqual([]);
  });
});

describe("immich-gallery 数据通道（sourceId 派发 + 缩略图代取）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;
  let thumbHits = 0;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-gal-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/api/assets/") && url.includes("/thumbnail")) {
        thumbHits++;
        res.setHeader("Content-Type", "image/jpeg");
        return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
      }
      if (url.startsWith("/api/search/metadata")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            assets: {
              items: [
                { id: "a1", type: "IMAGE", createdAt: "2026-09-26T02:27:30Z" },
                { id: "a2", type: "IMAGE", createdAt: "2026-09-26T02:27:31Z" },
              ],
            },
          }),
        );
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

  it("派发 Immich 连接 → 网格项（data URI）；非 Immich 连接显式拒绝", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "immich",
      name: "mock-immich",
      configJson: JSON.stringify({ url: base, apiKey: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const data = (await immichGalleryConnector.fetch(
      { type: "immich-gallery", config: { sourceId: id, limit: 6 } },
      ctx,
    )) as { items: Array<{ id: string; thumb: string }>; notes?: string[] };
    expect(data.items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(data.items[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(thumbHits).toBe(2);

    await expect(
      immichGalleryConnector.fetch({ type: "immich-gallery", config: {} }, ctx),
    ).rejects.toThrow("未选择数据连接");

    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-for-gal",
      configJson: JSON.stringify({ url: base }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      immichGalleryConnector.fetch({ type: "immich-gallery", config: { sourceId: wrongKind } }, ctx),
    ).rejects.toThrow("照片墙需要 Immich 连接");
  });
});
