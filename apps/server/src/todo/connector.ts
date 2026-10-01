import { and, asc, eq, inArray } from "drizzle-orm";

import type { WidgetDataQuery, WidgetConnector, FetchContext } from "../connector/registry.ts";
import { tagTarget, todo } from "../db/schema.ts";

/**
 * Todo connector — 数据通道的 workspace 资源实现（FR-W3）。
 * Widget 配置 { list?, filter? } → 查询 Workspace 级 todo 数据。
 */
export const todoConnector: WidgetConnector = {
  type: "todo",
  async fetch(query: WidgetDataQuery, ctx: FetchContext) {
    const list = typeof query.config.list === "string" ? query.config.list : undefined;
    const filter = typeof query.config.filter === "string" ? query.config.filter : "open";
    // SRV-10：归档项**不进组件**（与 REST 默认口径、schema 注释一致；数据源管理走 includeArchived 可见/可恢复）
    const where = list
      ? and(eq(todo.userId, ctx.userId), eq(todo.list, list), eq(todo.archived, false))
      : and(eq(todo.userId, ctx.userId), eq(todo.archived, false));
    let rows = await ctx.db
      .select()
      .from(todo)
      .where(where)
      .orderBy(asc(todo.sortOrder), asc(todo.createdAt));
    // FR-D3/D40：按标签选数据（OR 语义；空 = 全部）—— 与 REST 列表同口径
    const tagIds = Array.isArray(query.config.tagIds)
      ? query.config.tagIds.filter((x): x is string => typeof x === "string")
      : [];
    if (tagIds.length > 0) {
      const linked = await ctx.db
        .select({ targetId: tagTarget.targetId })
        .from(tagTarget)
        .where(
          and(
            eq(tagTarget.userId, ctx.userId),
            eq(tagTarget.targetType, "todo"),
            inArray(tagTarget.tagId, tagIds),
          ),
        );
      const allow = new Set(linked.map((l) => l.targetId));
      rows = rows.filter((r) => allow.has(r.id));
    }
    return {
      items: rows,
      open: rows.filter((r) => !r.done).length,
      done: rows.filter((r) => r.done).length,
      filter,
    };
  },
};
