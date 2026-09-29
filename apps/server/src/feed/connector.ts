import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";

import type { WidgetConnector, WidgetDataQuery, FetchContext } from "../connector/registry.ts";
import { outboundRequest } from "../connector/registry.ts";
import { feedRead, feedSource } from "../db/schema.ts";

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
    const limit = typeof query.config.limit === "number" ? query.config.limit : 20;
    const sources = await ctx.db
      .select()
      .from(feedSource)
      .where(eq(feedSource.userId, ctx.userId));

    const entries: Array<Record<string, unknown>> = [];
    const errors: Array<{ title: string; error: string }> = [];
    await Promise.all(
      sources.map(async (s) => {
        try {
          const res = await outboundRequest(s.url, { maxBytes: 2_000_000 });
          if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
          const parsed = parseEntries(res.text, s.url);
          for (const e of parsed) entries.push({ ...e, sourceTitle: s.title });
        } catch (err) {
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
    const items = entries.slice(0, limit).map((e) => ({
      ...e,
      read: readSet.has(String(e.itemKey)),
    }));

    return {
      items,
      unread: items.filter((i) => !i.read).length,
      sourceCount: sources.length,
      errors,
    };
  },
};
