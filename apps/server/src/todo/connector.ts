import { and, asc, eq } from "drizzle-orm";

import type { WidgetDataQuery, WidgetConnector, FetchContext } from "../connector/registry.ts";
import { todo } from "../db/schema.ts";

/**
 * Todo connector — 数据通道的 workspace 资源实现（FR-W3）。
 * Widget 配置 { list?, filter? } → 查询 Workspace 级 todo 数据。
 */
export const todoConnector: WidgetConnector = {
  type: "todo",
  async fetch(query: WidgetDataQuery, ctx: FetchContext) {
    const list = typeof query.config.list === "string" ? query.config.list : undefined;
    const filter = typeof query.config.filter === "string" ? query.config.filter : "open";
    const where = list
      ? and(eq(todo.userId, ctx.userId), eq(todo.list, list))
      : eq(todo.userId, ctx.userId);
    const rows = await ctx.db
      .select()
      .from(todo)
      .where(where)
      .orderBy(asc(todo.sortOrder), asc(todo.createdAt));
    return {
      items: rows,
      open: rows.filter((r) => !r.done).length,
      done: rows.filter((r) => r.done).length,
      filter,
    };
  },
};
