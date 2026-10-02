import type { FastifyInstance } from "fastify";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { deleteCredentialIfOrphan } from "../credentials/store.ts";
import { dataSource } from "../db/schema.ts";

/** D42：连接类型白名单 —— 扩展 = 加枚举值。 */
const DATA_SOURCE_KINDS = ["monitor", "opencode", "http", "immich", "navidrome", "portainer", "mihomo", "ws"] as const; // Q39/D46：第三方服务四类（metacubexd 归 mihomo）；ws=D56/Q77
type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

/** 各类连接的 config 允许键（secret 字段与表单同名，值为凭证库 SecretRef，SEC3）。 */
const DATA_SOURCE_CONFIG_KEYS: Record<DataSourceKind, readonly string[]> = {
  monitor: ["url", "authMode", "username", "password", "apiToken"], // password=旧键（Q36 起新表单用 apiToken）
  opencode: ["url", "apiToken"],
  http: ["url", "authHeader", "apiToken"],
  // Q39/D46：服务概览四类（认证字段与各服务 API 对齐；secret 值为凭证库引用 SEC3）
  immich: ["url", "apiKey"],
  navidrome: ["url", "username", "password"],
  portainer: ["url", "apiToken", "restartAllow"], // restartAllow=容器重启白名单（Q56/D51，逗号分隔或数组，空=禁止重启）
  mihomo: ["url", "secret"],
  // D56/Q77：WS 数据源（认证头注入，凭证引用 SEC3）
  ws: ["url", "authHeader", "apiToken"],
};

const kindField = z.enum(DATA_SOURCE_KINDS);
const configField = z.record(z.string(), z.unknown());

const createBody = z.object({
  kind: kindField,
  name: z.string().min(1).max(64),
  config: configField.default({}),
});

const patchBody = z
  .object({
    name: z.string().min(1).max(64).optional(),
    config: configField.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

const idParams = z.object({ id: z.string().min(1).max(64) });

/** config 键白名单校验（未知键拒绝 —— 防配置污染）。
 *  SRV-07：损坏的 configJson **不再静默吞成空表单** —— 抛出「原因 + 怎么修」，
 *  由列表按行捕获后以 `configError` 随行返回（管理面可见、其余行不受影响）。 */
function parseConfig(configJson: string): Record<string, unknown> {
  try {
    return JSON.parse(configJson) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      "连接配置已损坏（JSON 解析失败）—— 请重新填写并保存一次配置",
      { cause: err },
    );
  }
}

function configOk(kind: DataSourceKind, config: Record<string, unknown>): string | null {
  const allowed = DATA_SOURCE_CONFIG_KEYS[kind];
  for (const k of Object.keys(config)) {
    if (!allowed.includes(k)) return `unknown config key: ${k}`;
  }
  return null;
}

export function registerDataSourceRoutes(app: FastifyInstance, opts: { onSourcesChanged?: () => void } = {}): void {
  // GET /api/data-sources?kind= —— 命名连接列表（config 解析后原样返回，secret 均为引用）
  // Q31：行须带解析后的 config 对象 —— 只回 configJson 字符串会让前端 r.config.url 崩（监控源详情空白）
  app.get("/api/data-sources", { preHandler: authGuard }, async (req) => {
    const q = (typeof req.query === "object" && req.query) ? (req.query as Record<string, unknown>) : {};
    const kind = q.kind != null ? String(q.kind) : undefined;
    const where = kind
      ? and(eq(dataSource.userId, req.user!.id), eq(dataSource.kind, kind))
      : eq(dataSource.userId, req.user!.id);
    const rows = await app.db
      .select()
      .from(dataSource)
      .where(where)
      .orderBy(asc(dataSource.kind), asc(dataSource.name));
    return rows.map((r) => {
      // SRV-07：单行损坏不让整表 500 —— 该行带 `configError`，其余行照常
      try {
        return { ...r, config: parseConfig(r.configJson) };
      } catch (e) {
        return { ...r, config: {}, configError: e instanceof Error ? e.message : "配置解析失败" };
      }
    });
  });

  // POST /api/data-sources —— 创建（同 kind 同名 409）
  app.post("/api/data-sources", { preHandler: authGuard }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid data source" });
    const { kind, name, config } = parsed.data;
    const bad = configOk(kind, config);
    if (bad) return reply.code(400).send({ error: bad });
    const userId = req.user!.id;
    const dup = await app.db
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(and(eq(dataSource.userId, userId), eq(dataSource.kind, kind), eq(dataSource.name, name)))
      .limit(1);
    if (dup.length > 0) return reply.code(409).send({ error: "data source name exists" });
    const now = new Date();
    const row = {
      id: crypto.randomUUID(),
      userId,
      kind,
      name,
      configJson: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    };
    await app.db.insert(dataSource).values(row);
    opts.onSourcesChanged?.(); // D56/Q77：连接清单变更 → WS 管理器对账
    return reply.code(201).send({ ...row, config });
  });

  // PATCH /api/data-sources/:id —— 改名 / 换配置
  app.patch("/api/data-sources/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = patchBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const rows = await app.db
      .select()
      .from(dataSource)
      .where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    let configJson: string | undefined;
    if (body.data.config) {
      const bad = configOk(rows[0].kind as DataSourceKind, body.data.config);
      if (bad) return reply.code(400).send({ error: bad });
      // Q27a：合并而非整体替换 —— 编辑时密钥字段留空 = 保留原 SecretRef（同「口令留空不改」语义）
      let oldConfig: Record<string, unknown> = {};
      try {
        oldConfig = JSON.parse(rows[0].configJson) as Record<string, unknown>;
      } catch {
        /* noop */
      }
      configJson = JSON.stringify({ ...oldConfig, ...body.data.config });
    }
    await app.db
      .update(dataSource)
      .set({
        name: body.data.name,
        configJson,
        updatedAt: new Date(),
      })
      .where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)));
    opts.onSourcesChanged?.(); // D56/Q77：连接清单变更 → WS 管理器对账
    return { ok: true };
  });

  // DELETE /api/data-sources/:id —— 删连接（组件内联回落不受影响；业务数据不动）
  app.delete("/api/data-sources/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const rows = await app.db
      .select({ id: dataSource.id, configJson: dataSource.configJson })
      .from(dataSource)
      .where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: "not found" });
    await app.db.delete(dataSource).where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)));
    // Q98b（备查项）：连带回收**孤儿凭证**（configJson 里的 credentialRef；仍被引用则保留）
    for (const id of [...(row.configJson ?? "").matchAll(/"credentialId"\s*:\s*"([^"]+)"/g)].map((m) => m[1])) {
      await deleteCredentialIfOrphan(app.db, userId, id);
    }
    opts.onSourcesChanged?.(); // D56/Q77：连接清单变更 → WS 管理器对账
    return { ok: true };
  });

}
