import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openApiDoc } from "./openapi.ts";

/** CON-1（Q100b）：**OpenAPI ↔ 路由双向漂移守卫**。
 *  此前契约只登记 9/66 个操作（名存实亡，③ 的三方对账无从谈起）；补齐后用本测试锁死：
 *  新增路由不入册 → 红；入册了路由不存在 → 也红。 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** 从源码收集 `app.<method>("<path>"` 注册（与实现同源，改路由必动这些文件）。 */
function registeredRoutes(): Set<string> {
  const found = new Set<string>();
  const re = /app\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*"([^"]+)"/g;
  for (const f of sourceFiles(join(import.meta.dirname, ".."))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(re)) {
      const path = m[2].replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      found.add(`${m[1]} ${path}`);
    }
  }
  return found;
}

function documentedOps(): Set<string> {
  const found = new Set<string>();
  const paths = openApiDoc.paths as Record<string, Record<string, unknown>>;
  for (const [p, ops] of Object.entries(paths)) {
    for (const method of Object.keys(ops)) found.add(`${method} ${p}`);
  }
  return found;
}

describe("OpenAPI 契约覆盖（CON-1）", () => {
  const routes = registeredRoutes();
  const doc = documentedOps();

  it("每个已注册路由都在 OpenAPI 里有名字（新路由必须入册）", () => {
    const missing = [...routes].filter((r) => !doc.has(r)).toSorted();
    expect(missing).toEqual([]);
  });

  it("OpenAPI 里的每个操作都对应真实路由（不登记幽灵路径）", () => {
    const ghosts = [...doc].filter((d) => !routes.has(d)).toSorted();
    expect(ghosts).toEqual([]);
  });

  it("规模护栏：契约不是空壳（≥60 个操作）", () => {
    expect(routes.size).toBeGreaterThanOrEqual(60);
    expect(doc.size).toBe(routes.size);
  });
});
