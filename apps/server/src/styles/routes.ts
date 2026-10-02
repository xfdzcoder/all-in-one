import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { authGuard } from "../auth/guard.ts";
import { config } from "../config.ts";
import { cssRestoreBody, cssSaveBody } from "../api/schemas.ts";

/**
 * 自定义 CSS 的读写与历史备份（FR-S3/Q111，**D70**）。
 *
 * 用户样式一直是「手工编辑 `./data/custom.css`」（D39 契约，`GET /custom.css` 合成下发）；
 * 本模块把它搬进设置页：保存 = 落盘 + **自动备份旧版**（`dataDir/custom-css-history/`），
 * 可回滚。**只操作固定文件**（不接受任何路径参数，防穿越）；备份 id 严格白名单校验。
 */
const MAX_CSS_BYTES = 256_000;
const HISTORY_DIR = "custom-css-history";
/** 最多保留的历史版本数（超出从最旧开始删）。 */
const HISTORY_LIMIT = 20;
/** 备份 id：`<ISO 时间戳文件名安全化>-<6 位随机>`（如 `2026-10-02T14-30-00-000Z-a1b2c3`）。 */
const BACKUP_ID_RE = /^[\w.-]{1,80}$/;

function customCssPath(): string {
  return path.join(config.dataDir, "custom.css");
}

function historyDir(): string {
  return path.join(config.dataDir, HISTORY_DIR);
}

function readCustomCss(): string {
  const file = customCssPath();
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** 备份当前内容到历史目录（写前备份 = 每次保存都留可回滚版本），返回备份 id。 */
function backupCurrent(css: string): string {
  const dir = historyDir();
  mkdirSync(dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
  writeFileSync(path.join(dir, `${id}.css`), css, "utf8");
  pruneHistory(dir);
  return id;
}

function pruneHistory(dir: string): void {
  const ids = listBackupIds(dir);
  for (const old of ids.slice(HISTORY_LIMIT)) {
    rmSync(path.join(dir, `${old.id}.css`), { force: true });
  }
}

function listBackupIds(dir = historyDir()): Array<{ id: string; at: string; size: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".css") && BACKUP_ID_RE.test(f.slice(0, -4)))
    .map((f) => {
      const id = f.slice(0, -4);
      return { id, at: id.slice(0, 24), size: statSync(path.join(dir, f)).size };
    })
    .toSorted((a, b) => (a.id < b.id ? 1 : -1)); // 新的在前（id 前缀是时间戳，字典序 = 时间序）
}

export function registerStyleRoutes(app: FastifyInstance): void {
  // GET —— 当前样式 + 历史清单（元数据，不下发历史正文）
  app.get("/api/styles/custom-css", { preHandler: authGuard }, async () => ({
    css: readCustomCss(),
    backups: listBackupIds().slice(0, HISTORY_LIMIT),
  }));

  // PUT —— 保存（写前自动备份旧版；幂等留痕，不覆盖历史）
  app.put("/api/styles/custom-css", { preHandler: authGuard }, async (req, reply) => {
    const parsed = cssSaveBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: `CSS 内容过大或格式不对（上限 ${MAX_CSS_BYTES} 字节）` });
    }
    const current = readCustomCss();
    const backupId = current.trim() ? backupCurrent(current) : null;
    writeFileSync(customCssPath(), parsed.data.css, "utf8");
    return { ok: true, backupId, backups: listBackupIds().slice(0, HISTORY_LIMIT) };
  });

  // POST /restore —— 回滚到某备份（当前内容同样先备份，回滚也可回滚）
  app.post("/api/styles/custom-css/restore", { preHandler: authGuard }, async (req, reply) => {
    const parsed = cssRestoreBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid backup id" });
    const src = path.join(historyDir(), `${parsed.data.id}.css`);
    // BACKUP_ID_RE + basename 双保险：id 里不可能有分隔符，但防御性显式校验
    if (path.basename(`${parsed.data.id}.css`) !== `${parsed.data.id}.css` || !existsSync(src)) {
      return reply.code(404).send({ error: "备份不存在" });
    }
    const backupText = readFileSync(src, "utf8");
    const current = readCustomCss();
    const backupId = current.trim() ? backupCurrent(current) : null;
    writeFileSync(customCssPath(), backupText, "utf8");
    return { ok: true, css: backupText, backupId, backups: listBackupIds().slice(0, HISTORY_LIMIT) };
  });
}
