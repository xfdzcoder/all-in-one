import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { config } from "../config.ts";
import { customIcon } from "../db/schema.ts";
import { looksUnsafeSvg, sanitizeSvg } from "./sanitize.ts";

/**
 * 自定义图标库（Q38b/D45）：上传 SVG/PNG/WebP → dataDir/icons/<id>.<ext>；
 * 配置侧以 `/api/icons/:id` URL 或 `custom:<id>` 引用（ServiceIcon 消费）。
 * 安全：上传期 SVG 净化 + 下发 CSP sandbox / nosniff（双层）；图标非密钥，不入凭证库。
 */

const MAX_BYTES = 512 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/webp": "webp",
};

const uploadBody = z.object({
  name: z.string().min(1).max(64),
  mime: z.string().min(1).max(64),
  dataBase64: z.string().min(1).max(1_000_000),
});

const idParams = z.object({ id: z.string().min(1).max(64) });

function iconsDir(): string {
  return path.join(config.dataDir, "icons");
}

export function registerIconRoutes(app: FastifyInstance): void {
  // GET /api/icons —— 自定义图标清单
  app.get("/api/icons", { preHandler: authGuard }, async (req) => {
    return app.db
      .select()
      .from(customIcon)
      .where(eq(customIcon.userId, req.user!.id))
      .orderBy(asc(customIcon.createdAt));
  });

  // POST /api/icons —— 上传（base64；SVG 服务端净化）
  app.post("/api/icons", { preHandler: authGuard, bodyLimit: 1_000_000 }, async (req, reply) => {
    const parsed = uploadBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid icon" });
    const { name, mime } = parsed.data;
    const ext = MIME_EXT[mime];
    if (!ext) return reply.code(400).send({ error: "unsupported mime" });
    let bytes = Buffer.from(parsed.data.dataBase64, "base64");
    if (bytes.length === 0) return reply.code(400).send({ error: "empty file" });
    if (bytes.length > MAX_BYTES) return reply.code(400).send({ error: "icon too large" });

    if (mime === "image/svg+xml") {
      const cleaned = sanitizeSvg(bytes.toString("utf8"));
      if (looksUnsafeSvg(cleaned)) return reply.code(400).send({ error: "svg rejected (script content)" });
      bytes = Buffer.from(cleaned, "utf8");
    }

    const id = crypto.randomUUID();
    await mkdir(iconsDir(), { recursive: true });
    await writeFile(path.join(iconsDir(), `${id}.${ext}`), bytes);
    const row = {
      id,
      userId: req.user!.id,
      name,
      mime,
      size: bytes.length,
      createdAt: new Date(),
    };
    await app.db.insert(customIcon).values(row);
    return reply.code(201).send(row);
  });

  // GET /api/icons/:id —— 图标文件（img src 直引；CSP sandbox 双层防护）
  app.get("/api/icons/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const rows = await app.db
      .select()
      .from(customIcon)
      .where(eq(customIcon.id, params.data.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: "not found" });
    const ext = MIME_EXT[row.mime] ?? "bin";
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(iconsDir(), `${row.id}.${ext}`));
    } catch {
      return reply.code(404).send({ error: "icon file missing" });
    }
    return reply
      .header("Content-Type", row.mime)
      .header("X-Content-Type-Options", "nosniff")
      // 直开导航也不给脚本执行面（D25 同族）
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .header("Cache-Control", "private, max-age=3600")
      .send(bytes);
  });

  // DELETE /api/icons/:id —— 删行 + 删文件（数据边界：仅图标，业务数据不动）
  app.delete("/api/icons/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const rows = await app.db
      .select()
      .from(customIcon)
      .where(eq(customIcon.id, params.data.id))
      .limit(1);
    const row = rows[0];
    if (!row || row.userId !== req.user!.id) return reply.code(404).send({ error: "not found" });
    await app.db.delete(customIcon).where(eq(customIcon.id, row.id));
    const ext = MIME_EXT[row.mime] ?? "bin";
    await rm(path.join(iconsDir(), `${row.id}.${ext}`), { force: true });
    return { ok: true };
  });
}
