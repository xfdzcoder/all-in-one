/**
 * 归一化小工具（SRV-16 收口）。
 * 此前 `str`/`num` 在 6+ 个 connector / routes 各复制一份，且签名漂移：
 * - 多数：`str`/`num` 拿不到回 `undefined`；
 * - 个别 connector：`num` 回 `0`；
 * - feed/connector.ts：`str` 对非字符串**宽松强转** `String(v)`（RSS 字段可能是数字）。
 * 收口后语义显式分名：`str`/`num`（严格）+ `strLoose`（宽松）。
 */

/** 严格字符串：仅非空 string 通过，否则 `undefined`。 */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 严格数字：仅有限 number 通过，否则 `undefined`。 */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 宽松字符串（feed 语义：非字符串也强转，null/undefined 回 ""）。 */
export function strLoose(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
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
