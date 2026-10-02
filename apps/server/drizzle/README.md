# Drizzle 迁移说明（D18 / SRV-11）

## 约定

- **迁移由 `drizzle-kit generate` 生成，禁止手写 DDL**（D18）：改 `src/db/schema.ts` 后执行

  ```bash
  pnpm --filter @all-in-one/server exec drizzle-kit generate
  ```

  生成的 SQL 落在本目录（`NNNN_*.sql`），`meta/` 是 drizzle-kit 的快照（**不是备份**）。
- **启动自动 apply**：`db/client.ts` 的 `migrate()` 在进程启动时按序执行未应用的迁移（`_migrations` 表记账）。
- SQLite（libsql）单文件数据库，WAL 模式。

## 回滚（SRV-11）

drizzle-kit 生成的迁移是 **up-only**——没有 `down` 脚本，**不要指望自动回滚**。需要回退时按此顺序：

1. **优先：从备份还原**（部署文档的备份口径：整体拷 `./data` 目录，含 `app.db`/`app.db-wal`/`app.db-shm`）。
   还原前先停容器/进程（WAL 文件必须成套还原）。
2. **无备份时：手工写 down SQL**。每个迁移的 up 语句都是逐条 DDL，反向操作即可
   （`CREATE TABLE` ↔ `DROP TABLE`、`ADD COLUMN` ↔ `DROP COLUMN`、`CREATE INDEX` ↔ `DROP INDEX`）；
   数据不可逆的变更（改列类型/删列）**必须先备份再动**。
3. **半应用状态**（migrate 中途失败）：`_migrations` 表只在**整条迁移成功后**记账 —— 失败的那条可以
   修好后重启进程重跑；若失败发生在 DDL 中途，先按第 2 步手工补反向语句再重启。

## schemaVersion 演进

`src/db/schema.ts` 的 `LAYOUT_SCHEMA_VERSION`（布局 JSON 的结构版本）与迁移编号是**两条独立演进线**：

- 迁移编号 = 表结构（DDL）演进；
- `LAYOUT_SCHEMA_VERSION` = `dashboard.layoutJson` 里的 widget 结构演进（前端渲染兼容判断用）。

改布局结构时 bump `LAYOUT_SCHEMA_VERSION` 并在 `dashboard/` 侧做一次性数据迁移；改表结构时走 drizzle 迁移。
两者不要混用同一套编号。
