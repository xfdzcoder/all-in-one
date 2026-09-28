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
  /** argon2id hash — populated in M1-③; empty until then. */
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

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Dashboard = typeof dashboard.$inferSelect;
export type NewDashboard = typeof dashboard.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

/** DDL kept in sync with the Drizzle tables above (boot-time ensure). */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  icon           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  layout_json    TEXT NOT NULL DEFAULT '[]',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS dashboard_user_id_idx ON dashboard (user_id);

CREATE TABLE IF NOT EXISTS session (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);
`;
