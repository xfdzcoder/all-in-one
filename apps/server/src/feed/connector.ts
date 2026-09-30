import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";

import type { WidgetConnector, WidgetDataQuery, FetchContext } from "../connector/registry.ts";
import { outboundRequest } from "../connector/registry.ts";
import { feedRead, feedSource, tagTarget } from "../db/schema.ts";

/**
 * RSS connector —— 多源聚合 + 摘要 + 已读标记（FR：未读标记归 Workspace）。
 * 条目现取（每源独立容错），itemKey = guid/link 稳定哈希；已读态从 feed_read 关联。
 */

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type RawEntry = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function itemKeyOf(url: string, guid: string, link: string): string {
  return createHash("sha256").update(`${url}|${guid || link}`).digest("hex").slice(0, 32);
}

/** 解析 RSS 2.0 / Atom 条目（fast-xml-parser，成熟 XML 库）。 */
function parseEntries(xmlText: string, sourceUrl: string): Array<Record<string, unknown>> {
  const doc = xml.parse(xmlText) as Record<string, unknown>;
  const out: Array<Record<string, unknown>> = [];

  const rssChannel = (doc.rss as RawEntry | undefined)?.channel as RawEntry | undefined;
  const rssItems = asArray(rssChannel?.item as RawEntry | RawEntry[] | undefined);
  for (const it of rssItems) {
    const link = str(it.link);
    out.push({
      title: str(it.title),
      link,
      summary: str(it.description).replace(/<[^>]+>/g, " ").trim().slice(0, 300),
      date: str(it.pubDate),
      guid: str(it.guid),
      sourceUrl,
      itemKey: itemKeyOf(sourceUrl, str(it.guid), link),
    });
  }

  const feed = doc.feed as RawEntry | undefined;
  const atomEntries = asArray(feed?.entry as RawEntry | RawEntry[] | undefined);
  for (const en of atomEntries) {
    // Atom link 可能是数组/对象
    let link = "";
    const l = en.link;
    if (typeof l === "string") link = l;
    else if (Array.isArray(l)) link = str(l[0]?.["@_href"] ?? l[0]);
    else if (l && typeof l === "object") link = str((l as RawEntry)["@_href"]);
    out.push({
      title: str(en.title),
      link,
      summary: str(en.summary ?? en.content).replace(/<[^>]+>/g, " ").trim().slice(0, 300),
      date: str(en.updated ?? en.published),
      guid: str(en.id),
      sourceUrl,
      itemKey: itemKeyOf(sourceUrl, str(en.id), link),
    });
  }
  return out;
}

export const rssConnector: WidgetConnector = {
  type: "rss",
  async fetch(query: WidgetDataQuery, ctx: FetchContext) {
    // Q22a 条目数语义 =「展示条数」：先按 filter 过滤再切片（否则「仅未读 + 条目数 10」
    // 会先混切 10 条再过滤 → 实际不足 10 行）；数值容错（配置/种子可能给字符串）。
    const rawLimit = query.config.limit;
    const parsedLimit = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.floor(parsedLimit)) : 20;
    const onlyUnread = query.config.filter === "unread";
    // FR-D3/D40：按标签选源（OR 语义；空 = 全部）
    const tagIds = Array.isArray(query.config.tagIds)
      ? query.config.tagIds.filter((x): x is string => typeof x === "string")
      : [];
    let sources = await ctx.db
      .select()
      .from(feedSource)
      .where(eq(feedSource.userId, ctx.userId));
    if (tagIds.length > 0) {
      const linked = await ctx.db
        .select({ targetId: tagTarget.targetId })
        .from(tagTarget)
        .where(
          and(
            eq(tagTarget.userId, ctx.userId),
            eq(tagTarget.targetType, "feed"),
            inArray(tagTarget.tagId, tagIds),
          ),
        );
      const allow = new Set(linked.map((l) => l.targetId));
      sources = sources.filter((s) => allow.has(s.id));
    }

    const entries: Array<Record<string, unknown>> = [];
    const errors: Array<{ title: string; error: string }> = [];
    // Q29c/二.1：已拉取条目落库快照；失败时兜底展示上次快照（无 TTL，暂不提供清理配置）
    const staleSources: string[] = [];
    await Promise.all(
      sources.map(async (s) => {
        try {
          const res = await outboundRequest(s.url, { maxBytes: 2_000_000 });
          if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
          const parsed = parseEntries(res.text, s.url);
          for (const e of parsed) entries.push({ ...e, sourceTitle: s.title });
          await ctx.db
            .update(feedSource)
            .set({ snapshotJson: JSON.stringify(parsed), snapshotAt: new Date() })
            .where(eq(feedSource.id, s.id));
        } catch (err) {
          if (s.snapshotJson) {
            try {
              const cached = JSON.parse(s.snapshotJson) as Array<Record<string, unknown>>;
              for (const e of cached) entries.push({ ...e, sourceTitle: s.title, stale: true });
              staleSources.push(s.title);
              return;
            } catch {
              /* 落回错误态 */
            }
          }
          errors.push({ title: s.title, error: err instanceof Error ? err.message : "fetch failed" });
        }
      }),
    );

    entries.sort((a, b) => str(b.date).localeCompare(str(a.date)));

    // 关联已读标记（Workspace 级 —— 任一组件标记，全部组件同步）
    const keys = entries.map((e) => String(e.itemKey));
    const readRows = keys.length
      ? await ctx.db
          .select({ itemKey: feedRead.itemKey })
          .from(feedRead)
          .where(and(eq(feedRead.userId, ctx.userId), inArray(feedRead.itemKey, keys)))
      : [];
    const readSet = new Set(readRows.map((r) => r.itemKey));
    const all = entries.map((e) => ({
      ...e,
      read: readSet.has(String(e.itemKey)),
    }));
    const items = (onlyUnread ? all.filter((i) => !i.read) : all).slice(0, limit);

    return {
      items,
      // 徽标语义 = 全部未读（非仅当前页）——「未读 N」反映 Workspace 真实未读
      unread: all.filter((i) => !i.read).length,
      sourceCount: sources.length,
      errors,
      staleSources,
    };
  },
};
