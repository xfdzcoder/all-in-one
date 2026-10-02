import { z } from "zod";

import {
  dashboardCreateBody,
  dashboardPatchBody,
  layoutUpdateBody,
  loginBody,
} from "./schemas.ts";

function body(schema: z.ZodType, description: string) {
  return {
    required: true,
    description,
    content: { "application/json": { schema: z.toJSONSchema(schema) } },
  };
}

/** 单个操作的紧凑声明（CON-1：全部路由都要在契约里有名字）。 */
function op(
  summary: string,
  opts: {
    body?: z.ZodType;
    bodyDesc?: string;
    params?: string[];
    query?: string[];
    ok?: string;
    codes?: Record<string, { description: string }>;
    /** 默认需要会话；`false` = 公开端点（登录/回调/健康检查等）。 */
    auth?: boolean;
  } = {},
) {
  const params = opts.params?.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } }));
  const query = opts.query?.map((name) => ({ name, in: "query", required: false, schema: { type: "string" } }));
  return {
    summary,
    ...(opts.auth === false ? { security: [] } : {}),
    ...(params || query ? { parameters: [...(params ?? []), ...(query ?? [])] } : {}),
    ...(opts.body ? { requestBody: body(opts.body, opts.bodyDesc ?? "body") } : {}),
    responses: {
      "200": { description: opts.ok ?? "ok" },
      "400": { description: "invalid request" },
      "401": { description: "unauthorized" },
      ...opts.codes,
    },
  };
}

/** D11: OpenAPI 3.1 doc generated from the same zod schemas the routes validate with.
 *  CON-1（Q100b）：**全部 66 个操作入册**（此前仅 9 个，契约基准名存实亡）；
 *  `openapi.test.ts` 做双向漂移守卫 —— 新路由不入册 / 入册了不存在，测试即红。 */
export const openApiDoc = {
  openapi: "3.1.0",
  info: {
    title: "all-in-one API",
    version: "0.1.0",
    description: "Workbench REST API (session cookie auth: `sid`).",
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "sid" },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    // ── 基础 ──
    "/api/health": { get: op("Health check", { auth: false }) },
    "/api/openapi.json": { get: op("This document") },
    "/custom.css": { get: op("用户样式表 + Mantine 变量桥（CSS，非 JSON）", { ok: "css" }) },
    "/api/events": { get: op("SSE 事件流（失效广播）", { ok: "event stream" }) },

    // ── 认证（D11/D17）──
    "/api/auth/login": {
      post: op("Login, sets session cookie", {
        auth: false,
        body: loginBody,
        bodyDesc: "credentials",
        codes: { "401": { description: "invalid credentials" } },
      }),
    },
    "/api/auth/logout": { post: op("Logout, revokes session") },
    "/api/auth/me": { get: op("Current user") },

    // ── 页面（FR-P*：Workspace 拥有数据 / Dashboard 只拥有布局）──
    "/api/dashboards": {
      get: op("List dashboards"),
      post: op("Create dashboard", { body: dashboardCreateBody, bodyDesc: "dashboard" }),
    },
    "/api/dashboards/{id}": {
      patch: op("Update dashboard（名称/图标/背景/排序/布局/网格粒度）", {
        body: dashboardPatchBody,
        bodyDesc: "patch",
        params: ["id"],
      }),
      delete: op("Delete dashboard（不动业务数据）", { params: ["id"] }),
    },
    "/api/dashboards/{id}/layout": {
      put: op("Replace layout（自动保存目标，M1-⑤）", { body: layoutUpdateBody, bodyDesc: "layout", params: ["id"] }),
    },

    // ── Todo（D21/D43：数据归属 Workspace；分组名 = 卡片名）──
    "/api/todos": {
      get: op("List todos", { query: ["list", "filter", "tagIds", "includeArchived"] }),
      post: op("Create todo", { ok: "created" }),
    },
    "/api/todos/{id}": {
      patch: op("Update todo（勾选/标题/排序/归档）", { params: ["id"] }),
      delete: op("Delete todo", { params: ["id"] }),
    },
    "/api/todos/delete-group": { post: op("Delete a todo group（真删任务数据，D43）") },

    // ── RSS 信息源（FR-S*，只读聚合）──
    "/api/feeds": {
      get: op("List feed sources"),
      post: op("Subscribe feed", { ok: "created" }),
    },
    "/api/feeds/{id}": {
      delete: op("Unsubscribe feed（已读记录保留）", { params: ["id"] }),
    },
    "/api/feeds/read": { post: op("Mark entry read", { ok: "ok" }) },

    // ── 标签（FR-D1~D4 / D40：多态关联）──
    "/api/tags": {
      get: op("List tags（含 targetCount）"),
      post: op("Create tag", { ok: "created" }),
    },
    "/api/tags/{id}": {
      patch: op("Rename / recolor tag", { params: ["id"] }),
      delete: op("Delete tag（FK 级联清关联）", { params: ["id"] }),
    },
    "/api/tags/targets": { put: op("Set tags of a target（覆盖式）") },

    // ── 凭证库（SEC3：只存密文，API 只见元数据）──
    "/api/credentials": {
      get: op("List credentials（仅元数据）"),
      post: op("Create credential（明文只在请求体内）", { ok: "created" }),
    },
    "/api/credentials/{id}": { delete: op("Delete credential", { params: ["id"] }) },

    // ── 数据源管理（D42：命名连接）──
    "/api/data-sources": {
      get: op("List data sources", { query: ["kind"] }),
      post: op("Create data source", { ok: "created" }),
    },
    "/api/data-sources/{id}": {
      patch: op("Update data source（合并语义；secret 留空 = 不改）", { params: ["id"] }),
      delete: op("Delete data source（连带回收孤儿凭证）", { params: ["id"] }),
    },

    // ── 自定义图标库（D45）──
    "/api/icons": {
      get: op("List icons（仅本人）"),
      post: op("Upload icon（SVG 净化 + CSP sandbox）", { ok: "created" }),
    },
    "/api/icons/{id}": {
      get: op("Icon file（归属校验，D39 双层防护）", { params: ["id"], ok: "binary" }),
      delete: op("Delete icon", { params: ["id"] }),
    },

    // ── 插件（FR-W5~W7 / D24-D27：ABI + 沙箱 + 权限白名单）──
    "/api/plugins": {
      get: op("List plugins（含权限声明）"),
      post: op("Install plugin（zip → validatePluginManifest）", { ok: "created" }),
    },
    "/api/plugins/{id}": {
      delete: op("Uninstall plugin（不动业务数据）", { params: ["id"] }),
    },
    "/api/plugins/{id}/entry": { get: op("Entry source（JSON 下发，进 iframe 沙箱）", { params: ["id"] }) },
    "/api/plugins/{id}/enable": { post: op("Enable plugin（复核 apiVersion）", { params: ["id"] }) },
    "/api/plugins/{id}/disable": { post: op("Disable plugin", { params: ["id"] }) },
    "/api/plugins/{id}/actions": { post: op("Execute plugin action（D27：白名单 + 审计）", { params: ["id"] }) },

    // ── 看板（FR-K* / D21/D28/D29）──
    "/api/kanban/boards": {
      get: op("List boards"),
      post: op("Create board", { ok: "created" }),
    },
    "/api/kanban/boards/{id}": {
      get: op("Board tree（列 + 卡）", { params: ["id"] }),
      patch: op("Rename board", { params: ["id"] }),
      delete: op("Delete board（级联列/卡）", { params: ["id"] }),
    },
    "/api/kanban/columns": { post: op("Create column", { ok: "created" }) },
    "/api/kanban/columns/{id}": {
      patch: op("Rename / reorder column", { params: ["id"] }),
      delete: op("Delete column（连带卡片）", { params: ["id"] }),
    },
    "/api/kanban/cards": { post: op("Create card", { ok: "created" }) },
    "/api/kanban/cards/{id}": {
      patch: op("Update / move card（columnId + sortOrder）", { params: ["id"] }),
      delete: op("Delete card", { params: ["id"] }),
    },

    // ── 邮件（D30/D37：只读聚合，无写邮箱端点）──
    "/api/mail/accounts": {
      get: op("List mail accounts（不含口令）"),
      post: op("Create mail account（口令入凭证库，SEC3）", { ok: "created" }),
    },
    "/api/mail/accounts/{id}": {
      patch: op("Update account（口令留空 = 不改）", { params: ["id"] }),
      delete: op("Delete account（连带回收孤儿凭证）", { params: ["id"] }),
    },
    "/api/mail/messages": {
      get: op("Aggregated messages（逐账号错误隔离）", { query: ["account", "accountIds", "limit", "force"] }),
    },
    "/api/mail/messages/{accountId}/{uid}": {
      get: op("Message body（截断 + 沙箱渲染前取回）", { params: ["accountId", "uid"] }),
    },
    "/api/mail/messages/{accountId}/{uid}/read": {
      post: op("Mark message read（D64：本地已读幂等，服务商状态不回写）", { params: ["accountId", "uid"], ok: "ok" }),
    },
    "/api/mail/gmail/authorize": { post: op("Start Gmail OAuth（D37）", { ok: "authorize url" }) },
    "/api/mail/gmail/callback": {
      get: op("Gmail OAuth callback（state 防伪）", { auth: false, query: ["code", "state"] }),
    },

    // ── 数据通道与服务动作 ──
    "/api/widgets/data": {
      post: op("Widget data channel（FR-W3：统一取数入口）", { ok: "payload" }),
    },
    "/api/portainer/restart": {
      post: op("Restart container（D51：白名单 + 二次确认 + 审计）", { ok: "ok" }),
    },
  },
} as const;
