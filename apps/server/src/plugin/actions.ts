import { z, type ZodType } from "zod";

import type { PluginManifest } from "@all-in-one/widget-sdk";
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.ts";
import { feedRead, todo, type Plugin } from "../db/schema.ts";

/**
 * 插件动作执行通道（FR-I5/FR-W7，D27）：
 * 动作名须在 `permissions.actions` 白名单内，参数 zod 校验后由**服务端固定
 * registry** 执行（v1 = todo / feed 既有写操作；不执行任意代码）；每次执行记
 * 结构化审计日志（NFR1；参数不入日志避免用户内容/密钥外泄，公网化时升级审计表 SEC6）。
 */

export class PluginActionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PluginActionError";
    this.status = status;
  }
}

/** 变更主题（SSE 失效通知 + 数据缓存清理用）。 */
export type ActionTopic = "todo" | "rss";

interface ActionDef {
  schema: ZodType;
  topic: ActionTopic;
  run: (db: Db, userId: string, data: never) => Promise<unknown>;
}

function action<S extends ZodType>(
  schema: S,
  topic: ActionTopic,
  run: (db: Db, userId: string, data: z.infer<S>) => Promise<unknown>,
): ActionDef {
  return { schema, topic, run: run as ActionDef["run"] };
}

export const PLUGIN_ACTIONS: Record<string, ActionDef> = {
  "todo.create": action(
    z.object({ title: z.string().min(1).max(200), list: z.string().max(64).optional() }),
    "todo",
    async (db, userId, data) => {
      const now = new Date();
      const [row] = await db
        .insert(todo)
        .values({
          id: crypto.randomUUID(),
          userId,
          title: data.title,
          list: data.list ?? "inbox",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { id: row!.id };
    },
  ),
  "todo.toggle": action(
    z.object({ id: z.string().min(1).max(64), done: z.boolean().optional() }),
    "todo",
    async (db, userId, data) => {
      const [row] = await db
        .update(todo)
        .set({ done: data.done ?? true, updatedAt: new Date() })
        .where(and(eq(todo.id, data.id), eq(todo.userId, userId)))
        .returning();
      if (!row) throw new PluginActionError("not found", 404);
      return { id: row.id, done: row.done };
    },
  ),
  "feed.markRead": action(
    z.object({ itemKey: z.string().min(1).max(200) }),
    "rss",
    async (db, userId, data) => {
      const existing = await db
        .select({ id: feedRead.id })
        .from(feedRead)
        .where(and(eq(feedRead.userId, userId), eq(feedRead.itemKey, data.itemKey)))
        .limit(1);
      if (existing.length === 0) {
        await db
          .insert(feedRead)
          .values({ id: crypto.randomUUID(), userId, itemKey: data.itemKey, readAt: new Date() });
      }
      return { itemKey: data.itemKey, read: true };
    },
  ),
};

/** 执行插件动作：白名单 → registry → 参数校验 → 服务端执行。 */
export async function executePluginAction(
  db: Db,
  userId: string,
  pluginRow: Plugin,
  name: string,
  params: unknown,
): Promise<{ result: unknown; topic: ActionTopic }> {
  const manifest = JSON.parse(pluginRow.manifestJson) as PluginManifest;
  const allowed = manifest.plugin.permissions?.actions ?? [];
  if (!allowed.includes(name)) {
    throw new PluginActionError(`permission denied: action ${name} not declared`, 403);
  }
  const def = PLUGIN_ACTIONS[name];
  if (!def) throw new PluginActionError(`unknown action: ${name}`, 400);
  const parsed = def.schema.safeParse(params ?? {});
  if (!parsed.success) throw new PluginActionError(`invalid params for ${name}`, 400);
  const result = await def.run(db, userId, parsed.data as never);
  return { result, topic: def.topic };
}
