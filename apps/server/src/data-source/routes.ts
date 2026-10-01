import type { FastifyInstance } from "fastify";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authGuard } from "../auth/guard.ts";
import { dataSource } from "../db/schema.ts";

/** D42：连接类型白名单 —— 扩展 = 加枚举值。 */
export const DATA_SOURCE_KINDS = ["monitor", "opencode", "http", "immich", "navidrome", "portainer", "mihomo"] as const; // Q39/D46：第三方服务四类（metacubexd 归 mihomo）
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

/** 各类连接的 config 允许键（secret 字段与表单同名，值为凭证库 SecretRef，SEC3）。 */
export const DATA_SOURCE_CONFIG_KEYS: Record<DataSourceKind, readonly string[]> = {
  monitor: ["url", "authMode", "username", "password", "apiToken"], // password=旧键（Q36 起新表单用 apiToken）
  opencode: ["url", "apiToken"],
  http: ["url", "authHeader", "apiToken"],
  // Q39/D46：服务概览四类（认证字段与各服务 API 对齐；secret 值为凭证库引用 SEC3）
  immich: ["url", "apiKey"],
  navidrome: ["url", "username", "password"],
  portainer: ["url", "apiToken", "restartAllow"], // restartAllow=容器重启白名单（Q56/D51，逗号分隔或数组，空=禁止重启）
  mihomo: ["url", "secret"],
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

/** config 键白名单校验（未知键拒绝 —— 防配置污染）。 */
function parseConfig(configJson: string): Record<string, unknown> {
  try {
    return JSON.parse(configJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function configOk(kind: DataSourceKind, config: Record<string, unknown>): string | null {
  const allowed = DATA_SOURCE_CONFIG_KEYS[kind];
  for (const k of Object.keys(config)) {
    if (!allowed.includes(k)) return `unknown config key: ${k}`;
  }
  return null;
}

export function registerDataSourceRoutes(app: FastifyInstance): void {
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
    return rows.map((r) => ({ ...r, config: parseConfig(r.configJson) }));
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
    return { ok: true };
  });

  // DELETE /api/data-sources/:id —— 删连接（组件内联回落不受影响；业务数据不动）
  app.delete("/api/data-sources/:id", { preHandler: authGuard }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid request" });
    const userId = req.user!.id;
    const rows = await app.db
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "not found" });
    await app.db.delete(dataSource).where(and(eq(dataSource.userId, userId), eq(dataSource.id, params.data.id)));
    return { ok: true };
  });

  // GET /api/data-sources/kinds —— 字段契约（供管理表单动态渲染）
  app.get("/api/data-sources/kinds", { preHandler: authGuard }, async () =>
    DATA_SOURCE_KINDS.map((kind) => ({ kind, configKeys: DATA_SOURCE_CONFIG_KEYS[kind] })),
  );
}
