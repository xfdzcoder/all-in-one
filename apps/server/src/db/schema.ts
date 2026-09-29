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
