/**
 * 归一化小工具（SRV-16 收口）。
 * 此前 `str`/`num` 在 6+ 个 connector / routes 各复制一份，且签名漂移：
 * - 多数：`str`/`num` 拿不到回 `undefined`；
 * - 个别 connector：`num` 回 `0`；
 * - feed/connector.ts：`str` 对非字符串**宽松强转** `String(v)`（RSS 字段可能是数字）。
 * 收口后语义显式分名：`str`/`num`（严格）+ `textOf`（XML 节点/标量归一，D68）。
 */

/** 严格字符串：仅非空 string 通过，否则 `undefined`。 */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 严格数字：仅有限 number 通过，否则 `undefined`。 */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * **XML 节点文本归一**（D68，用户反馈「RSS 的标题和描述解析失败，都是 [object Object]」）。
 *
 * fast-xml-parser 配了 `ignoreAttributes: false` 后，**带属性的元素**解析成对象
 * `{ "#text": 文本, "@_type": ... }`（如 Atom `<title type="html">`、RSS
 * `<guid isPermaLink="true">`）——旧逻辑 `String(v)` 直接把对象转成 `"[object Object]"`。
 * 规则：标量原样（数字/布尔强转）、数组取首个非空成员、对象取 `#text`（递归）、
 * **纯属性节点/无文本回 ""**（调用方据此回落，如 guid 空则用 link）。
 */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = textOf(item);
      if (t) return t;
    }
    return "";
  }
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    if ("#text" in rec) return textOf(rec["#text"]);
    return "";
  }
  return "";
}

/**
 * 不可信 JSON 收窄（**SRV-25**）：解析 + 形状检查一步到位，
 * 替代 `JSON.parse(x) as Record<string, unknown>` 式断言逃逸（形状错只会在运行时炸）。
 * 断言只存在于这四个助手的边界内部 —— 调用点拿到的是已检查的形状。
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** 对象数组（逐项过滤掉非对象成员）。 */
export function asRecordArray(v: unknown): Array<Record<string, unknown>> | undefined {
  return Array.isArray(v)
    ? v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>
    : undefined;
}
