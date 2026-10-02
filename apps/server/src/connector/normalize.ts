/**
 * 归一化小工具（SRV-16 收口）。
 * 此前 `str`/`num` 在 6+ 个 connector / routes 各复制一份，且签名漂移：
 * - 多数：`str`/`num` 拿不到回 `undefined`；
 * - opencode.ts：`num` 回 `0`；
 * - feed/connector.ts：`str` 对非字符串**宽松强转** `String(v)`（RSS 字段可能是数字）。
 * 收口后语义显式分名：`str`/`num`（严格）+ `numOf`/`strLoose`（带回落/宽松）。
 */

/** 严格字符串：仅非空 string 通过，否则 `undefined`。 */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 严格数字：仅有限 number 通过，否则 `undefined`。 */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 数字带回落（opencode 语义：拿不到回 fallback，此前为 0）。 */
export function numOf(v: unknown, fallback: number): number {
  return num(v) ?? fallback;
}

/** 宽松字符串（feed 语义：非字符串也强转，null/undefined 回 ""）。 */
export function strLoose(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
