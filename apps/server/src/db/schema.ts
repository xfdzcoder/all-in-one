import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * NFR5/D9: every business table carries ownership (`user_id`) so multi-user
 * can land later without a rewrite. First version is single-user (one row in `user`).
 */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  /** argon2id hash (D17: populated from ADMIN_PASSWORD at first boot). */
  passwordHash: text("password_hash").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const dashboard = sqliteTable(
  "dashboard",
  {
    id: text("id").primaryKey(),
    /** Ownership field (NFR5). */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    icon: text("icon"),
    /** 页面背景色（FR-P9 页面级设置；空 = 默认深色底）。 */
    background: text("background"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** gridstack widget layout + per-widget config; Dashboard owns layout only. */
    layoutJson: text("layout_json").notNull().default("[]"),
    /** Version of the layoutJson document shape (K1 migration strategy). */
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("dashboard_user_id_idx").on(t.userId)],
);

export const session = sqliteTable(
  "session",
  {
    /** SHA-256 of the raw cookie token — never store the raw secret. */
    id: text("id").primaryKey(),
    /** Ownership field (SEC2/NFR5). */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

/** Current layoutJson document version written by this build. */
export const LAYOUT_SCHEMA_VERSION = 1;

export const credential = sqliteTable(
  "credential",
  {
    id: text("id").primaryKey(),
    /** Ownership field (NFR5) — Workspace-scoped secrets. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Secret kind hint for connector use (e.g. "http-header", "basic-auth"). */
    kind: text("kind").notNull().default("generic"),
    /** AES-256-GCM ciphertext (SEC3) — plaintext never stored or returned. */
    cipherText: text("cipher_text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("credential_user_id_idx").on(t.userId)],
);

/**
 * D21: 业务表用 user_id 代位 Workspace 归属（单用户 Workspace ≡ user）。
 * Todo 数据归 Workspace（01 §1.3）——删除 Dashboard/Widget 绝不删除这里的数据。
 */
export const todo = sqliteTable(
  "todo",
  {
    id: text("id").primaryKey(),
    /** Ownership field (D21/NFR5) — 亦即 Workspace 归属。 */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 清单名（默认 inbox）；widget 配置选择清单过滤。 */
    list: text("list").notNull().default("inbox"),
    title: text("title").notNull(),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("todo_user_id_idx").on(t.userId)],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Dashboard = typeof dashboard.$inferSelect;
export type NewDashboard = typeof dashboard.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Credential = typeof credential.$inferSelect;
export type NewCredential = typeof credential.$inferInsert;
export type Todo = typeof todo.$inferSelect;
export type NewTodo = typeof todo.$inferInsert;

/**
 * RSS 订阅源（Workspace 级数据，D21：user_id 代位）。
 * 条目本身不落库——由 connector 现取 + 缓存；只有"已读"状态需要持久化。
 */
export const feedSource = sqliteTable(
  "feed_source",
  {
    id: text("id").primaryKey(),
    /** Ownership field (D21/NFR5) — 亦即 Workspace 归属。 */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("feed_source_user_id_idx").on(t.userId)],
);

/**
 * RSS 已读标记（FR：未读标记归 Workspace —— 任一组件标记已读，其它组件同步）。
 * itemKey = 条目稳定标识（guid/link 的哈希）。
 */
export const feedRead = sqliteTable(
  "feed_read",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("feed_read_user_id_idx").on(t.userId),
    index("feed_read_user_item_idx").on(t.userId, t.itemKey),
  ],
);

export type FeedSource = typeof feedSource.$inferSelect;
export type NewFeedSource = typeof feedSource.$inferInsert;
export type FeedRead = typeof feedRead.$inferSelect;
export type NewFeedRead = typeof feedRead.$inferInsert;

/**
 * 代码级插件注册表（FR-W5③/FR-W6，D24 ABI）。
 * 插件包（zip）安装时解析 manifest.json → validatePluginManifest → 落盘
 * dataDir/plugins/<id>/ 并登记本表；删除插件 = 卸载（FR-W6），不动任何业务数据。
 */
export const plugin = sqliteTable(
  "plugin",
  {
    id: text("id").primaryKey(),
    /** Ownership field (NFR5/D21). */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** manifest.type —— 与内置组件/其它插件全局唯一。 */
    type: text("type").notNull().unique(),
    name: text("name").notNull(),
    /** PluginManifest JSON（含权限声明 FR-W7，公开元数据，非机密）。 */
    manifestJson: text("manifest_json").notNull(),
    /** 安装目录名（相对 dataDir/plugins；运行时据此加载 plugin.entry）。 */
    dir: text("dir").notNull(),
    /** installed | enabled | disabled（FR-W6；启用/禁用随运行时加载实现）。 */
    status: text("status").notNull().default("installed"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("plugin_user_id_idx").on(t.userId)],
);

export type Plugin = typeof plugin.$inferSelect;
export type NewPlugin = typeof plugin.$inferInsert;

/**
 * Kanban 看板（二期 Q6，多项目看板 01 §2.3/06 §1；D21：user_id 代位 Workspace 归属）。
 * 数据归 Workspace —— 删除 Dashboard/Widget/看板之外的任何东西都不动这里的卡片。
 * 三层：board（项目）→ column（列）→ card（卡片）；移动 = 卡片换列/排序（sortOrder）。
 */
export const kanbanBoard = sqliteTable("kanban_board", {
  id: text("id").primaryKey(),
  /** Ownership field (D21/NFR5) — 亦即 Workspace 归属。 */
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const kanbanColumn = sqliteTable(
  "kanban_column",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => kanbanBoard.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("kanban_column_user_idx").on(t.userId),
    index("kanban_column_board_idx").on(t.boardId),
  ],
);

export const kanbanCard = sqliteTable(
  "kanban_card",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => kanbanBoard.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => kanbanColumn.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** 归档（卡片操作的非破坏形态）；删除是显式动作。 */
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("kanban_card_user_idx").on(t.userId),
    index("kanban_card_board_idx").on(t.boardId),
    index("kanban_card_column_idx").on(t.columnId),
  ],
);

export type KanbanBoard = typeof kanbanBoard.$inferSelect;
export type NewKanbanBoard = typeof kanbanBoard.$inferInsert;
export type KanbanColumn = typeof kanbanColumn.$inferSelect;
export type NewKanbanColumn = typeof kanbanColumn.$inferInsert;
export type KanbanCard = typeof kanbanCard.$inferSelect;
export type NewKanbanCard = typeof kanbanCard.$inferInsert;

/**
 * 邮件账号（二期 Q7a，只读聚合 01 FR-E3/§2.3；D21：user_id 代位 Workspace 归属）。
 * 密码/应用专用密码存凭证库（SEC3）——本表只存 credential_id 引用，明文永不落库。
 * D3 边界：**只读** —— 不发送、不删除、不回写 IMAP 状态（无 SEEN 标记）。
 */
export const mailAccount = sqliteTable("mail_account", {
  id: text("id").primaryKey(),
  /** Ownership field (D21/NFR5) — 亦即 Workspace 归属。 */
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(993),
  /** ssl | starttls | plain（默认 ssl:993）。 */
  security: text("security").notNull().default("ssl"),
  username: text("username").notNull(),
  /** 凭证库引用（credential.id）——密码/应用专用密码（SEC3，软引用）。 */
  credentialId: text("credential_id"),
  /** 抓取文件夹（默认 INBOX）。 */
  folder: text("folder").notNull().default("INBOX"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type MailAccount = typeof mailAccount.$inferSelect;
export type NewMailAccount = typeof mailAccount.$inferInsert;
