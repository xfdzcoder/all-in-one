import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  immichGalleryConnector,
  immichPreviewConnector,
  normalizeImmichGallery,
  IMMICH_MAX_PAGES,
  IMMICH_PAGE_SIZE,
} from "./gallery.ts";
import { miniJpeg } from "./image-size.fixture.ts";
import type { FetchContext } from "./registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q50 契约测试（Immich 照片墙，FR-X3 只读深度 D50）。 */

describe("normalizeImmichGallery（D50）", () => {
  // Q88（项 3）：视频过滤在 fetch 分页循环里做，归一只接收**已筛选**条目；
  // 但归一仍如实标记 type，便于上游排查
  const assets: Array<Record<string, unknown>> = [
    { id: "a1", type: "IMAGE", takenAt: "2026-09-26T02:27:30Z", originalFileName: "a.jpg" },
    { id: "a2", type: "VIDEO", createdAt: "2026-09-26T02:27:31Z" },
    { id: "a3", type: "IMAGE", createdAt: "2026-09-26T02:27:32Z" }, // 无缩略图 → Q70 仍保留（占位块）
  ];

  it("缩略图 → data URI；**缺缩略图的项保留（thumb 空 → 占位块，Q70）**；VIDEO 标记；href 指向 Immich Web", () => {
    const thumbs = new Map<string, Uint8Array>([
      ["a1", miniJpeg(200, 100)], // D60 §1：可解析出 200×100
      ["a2", new Uint8Array([4, 5])], // 非图片字节 → 解析不出宽高
    ]);
    const items = normalizeImmichGallery(assets, thumbs, "https://immich.example/");
    // Q70：三项全保留（原先 a3 因缺缩略图被丢 → 网格缺格）
    expect(items.map((i) => i.id)).toEqual(["a1", "a2", "a3"]);
    expect(items[0].thumb.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(items[0].at).toBe("2026-09-26T02:27:30Z"); // takenAt 优先
    // D60 §1（Q89）：字节头解析出的宽高随 item 下发；解析不出/无字节则**不带**（前端 1:1 退化）
    expect(items[0].width).toBe(200);
    expect(items[0].height).toBe(100);
    expect(items[1].width).toBeUndefined();
    expect(items[2].width).toBeUndefined();
    expect(items[1].type).toBe("VIDEO");
    expect(items[1].href).toBe("https://immich.example/photos/a2");
    expect(items[2].thumb).toBe(""); // Q70：缺图不丢项，组件渲染占位块
  });

  it("空/畸形入参返回空数组", () => {
    expect(normalizeImmichGallery([], new Map(), "https://x")).toEqual([]);
    expect(normalizeImmichGallery([{ noId: true }], new Map(), "https://x")).toEqual([]);
    expect(normalizeImmichGallery([{ id: "" }], new Map(), "https://x")).toEqual([]);
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
  let searchCalls = 0;
  /** 切换 mock 夹具（「翻页补足」用例需要多页大数据）。 */
  let setFixture: (f: Array<Record<string, unknown>>) => void = () => {};

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-gal-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    // 可变夹具：默认单页 4 条；「翻页补足」用例会换成多页大数据（Q88/项 10）
    let fixture: Array<Record<string, unknown>> = [
      { id: "a1", type: "IMAGE", createdAt: "2026-09-26T02:27:30Z" },
      { id: "a2", type: "IMAGE", createdAt: "2026-09-26T02:27:31Z" },
      { id: "v1", type: "VIDEO", createdAt: "2026-09-26T02:27:32Z" }, // Q88/项 3：应被滤掉
      { id: "a3", type: "IMAGE", createdAt: "2026-09-26T02:27:33Z" }, // Q70：缺缩略图 → 占位块
    ];
    setFixture = (f) => {
      fixture = f;
      searchCalls = 0;
    };
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/api/assets/") && url.includes("/thumbnail")) {
        thumbHits++;
        // Q70 真机复刻：视频缩略图 404（Immich `Asset media not found`）
        if (url.includes("/api/assets/v1/") || url.includes("/api/assets/a3/")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ message: "Asset media not found" }));
        }
        // Q105（用户反馈④）：`size=preview` 回**大图**（1280×720）；p-fallback 的
        // preview 404 但 thumbnail 可取（回落分支）；a3 两级都 404（已置顶处理）
        const isPreview = url.includes("size=preview");
        if (isPreview && url.includes("/api/assets/p-fallback/")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ message: "preview not found" }));
        }
        res.setHeader("Content-Type", "image/jpeg");
        // 真 JPEG 头（含 SOF）→ `imageSize()` 能解析出声明宽高（D60 §1）
        return res.end(Buffer.from(isPreview ? miniJpeg(1280, 720) : miniJpeg(64, 48)));
      }
      if (url.startsWith("/api/search/metadata")) {
        // 按请求体的 page 分页返回 —— 用来验「翻页补足到选中数量」
        let raw = "";
        req.on("data", (c: Buffer) => {
          raw += c;
        });
        req.on("end", () => {
          let page = 1;
          try {
            page = Number((JSON.parse(raw) as { page?: number }).page) || 1;
          } catch {
            /* 非 JSON 请求体 */
          }
          searchCalls += 1;
          const start = (page - 1) * IMMICH_PAGE_SIZE;
          const items = page <= IMMICH_MAX_PAGES ? fixture.slice(start, start + IMMICH_PAGE_SIZE) : [];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ assets: { items } }));
        });
        return;
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
    )) as {
      items: Array<{ id: string; thumb: string; width?: number; height?: number }>;
      notes?: string[];
    };
    // Q70：缺缩略图的项仍保留（a3 缩略图 404 也不丢格）；
    // Q88（项 3）：v1 是 VIDEO —— 被 fetch 循环滤掉，且**不再为它浪费一次缩略图请求**
    expect(data.items.map((i) => i.id)).toEqual(["a1", "a2", "a3"]);
    expect(data.items[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.items[2].thumb).toBe(""); // Q70：缺图不丢项 → 组件渲染占位块
    // D60 §1（Q89）：宽高从缩略图**字节头**解析，随 item 一起下发
    expect(data.items[0].width).toBe(64);
    expect(data.items[0].height).toBe(48);
    expect(data.items[1].width).toBe(64);
    expect(data.items[2].width).toBeUndefined(); // 无字节 → 不下发，前端按 1:1 退化
    expect(thumbHits).toBe(3); // 只为 a1/a2/a3 抓图，v1 根本不抓
    const allNotes = data.notes?.join("\n") ?? "";
    // Q70：note 聚合，带真实响应体 + 怎么修（08 §5）
    expect(allNotes).toContain("1/3 个缩略图不可用");
    expect(allNotes).toContain("Asset media not found");
    expect(allNotes).toContain("生成缩略图");
    expect(allNotes).toContain("占位块");
    // Q88（项 10）：只取到 3 张、却选了 6 → 要说明原因，不能让用户以为是我们漏取
    expect(allNotes).toContain("只取到 3 张照片，少于选中的 6");

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

  it("Q105（用户反馈④）：灯箱预览大图 —— preview 大图 / 404 回落缩略图 / 两级全失败抛错（原因+怎么修）", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "immich",
      name: "mock-immich-preview",
      configJson: JSON.stringify({ url: base, apiKey: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // ① preview 可得：大图（1280×720）+ fallback=false
    const big = (await immichPreviewConnector.fetch(
      { type: "immich-preview", config: { sourceId: id, assetId: "a1" } },
      ctx,
    )) as { src: string; fallback: boolean; width?: number; height?: number };
    expect(big.fallback).toBe(false);
    expect(big.src.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(big.width).toBe(1280);
    expect(big.height).toBe(720);

    // ② preview 404 → 回落 thumbnail（64×48）且标 fallback（组件提示到 Immich 看原片）
    const fb = (await immichPreviewConnector.fetch(
      { type: "immich-preview", config: { sourceId: id, assetId: "p-fallback" } },
      ctx,
    )) as { src: string; fallback: boolean; width?: number };
    expect(fb.fallback).toBe(true);
    expect(fb.width).toBe(64);

    // ③ 两级都失败 → 抛错且「原因 + 怎么修」（D47 禁甩锅）
    await expect(
      immichPreviewConnector.fetch({ type: "immich-preview", config: { sourceId: id, assetId: "a3" } }, ctx),
    ).rejects.toThrow(/预览大图与缩略图都取不到.*asset\.view/s);

    // ④ 入参/连接类型防呆
    await expect(immichPreviewConnector.fetch({ type: "immich-preview", config: { sourceId: id } }, ctx)).rejects.toThrow(
      "缺少照片 id",
    );
    await expect(
      immichPreviewConnector.fetch({ type: "immich-preview", config: { assetId: "a1" } }, ctx),
    ).rejects.toThrow("未选择数据连接");
    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-for-preview",
      configJson: JSON.stringify({ url: base }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      immichPreviewConnector.fetch({ type: "immich-preview", config: { sourceId: wrongKind, assetId: "a1" } }, ctx),
    ).rejects.toThrow("预览大图需要 Immich 连接");
  });

  it("Q88（项 10）：翻页累加补足到选中张数，且全程滤掉视频（项 3）", async () => {
    // 第 1 页 60 条里一半是视频 → 单页只凑到 30 张图，必须翻第 2 页
    const many: Array<Record<string, unknown>> = [];
    for (let i = 0; i < IMMICH_PAGE_SIZE; i += 1) {
      many.push({ id: `p1-${i}`, type: i % 2 === 0 ? "IMAGE" : "VIDEO", createdAt: "2026-09-26T02:27:30Z" });
    }
    for (let i = 0; i < 30; i += 1) {
      many.push({ id: `p2-${i}`, type: "IMAGE", createdAt: "2026-09-26T02:27:31Z" });
    }
    setFixture(many);

    const [u] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    const paged = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: paged,
      userId: u.id,
      kind: "immich",
      name: "mock-immich-paging",
      configJson: JSON.stringify({ url: base, apiKey: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const data = (await immichGalleryConnector.fetch(
      { type: "immich-gallery", config: { sourceId: paged, limit: 50 } },
      ctx,
    )) as { items: Array<{ id: string; type: string }>; notes?: string[] };

    // 补足到 50：第 1 页 30 张图 + 第 2 页 20 张图
    expect(data.items).toHaveLength(50);
    expect(data.items.every((i) => i.type === "IMAGE")).toBe(true);
    expect(data.items.filter((i) => i.id.startsWith("p2-")).length).toBe(20);
    expect(searchCalls).toBe(2); // 恰好翻 2 页就够，不空转
    expect(data.notes ?? []).toHaveLength(0); // 补满了，不需要「补不满」说明
  });
});

describe("QA-001：data URI mime 按字节头（不再硬编码 image/jpeg）", () => {
  it("PNG 缩略图标 image/png", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const items = normalizeImmichGallery([{ id: "p1", type: "IMAGE" }], new Map([["p1", png]]), "https://immich.example/");
    expect(items[0].thumb.startsWith("data:image/png;base64,")).toBe(true);
  });
});
