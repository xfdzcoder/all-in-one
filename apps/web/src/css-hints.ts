import tokensCss from "./styles/tokens.css?raw";
import widgetsCss from "./styles/widgets.css?raw";

/**
 * 自定义 CSS 编辑器的**提示数据源**（FR-S3/Q111，**D70**）。
 *
 * 用户要「基本的语法高亮和代码提示」：除 CodeMirror 标准 CSS 补全外，还要提示本工作台的
 * `--wb-*` 设计令牌与 `.wb-*` 语义类名（D39：类名即公共 API，/custom.css 就靠它们覆盖）。
 * 数据源 = 构建期 `?raw` 导入 tokens.css / widgets.css **运行时提取** —— 零生成物、
 * 永不与样式表失同步（改令牌/加类，提示自动跟上）。
 */

/** 从 CSS 文本提取自定义属性名（`--wb-*` 声明处）。 */
export function extractCssVars(cssText: string): string[] {
  return [...new Set([...cssText.matchAll(/(--wb-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))].toSorted();
}

/** 从 CSS 文本提取 `.wb-*` 语义类名（选择器里出现过的）。 */
export function extractWbClasses(cssText: string): string[] {
  const names = [...cssText.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => n.startsWith("wb")))].toSorted();
}

/** 全站 `--wb-*` 令牌（模块级提取一次）。 */
export const WB_VARS = extractCssVars(`${tokensCss}\n${widgetsCss}`);
/** 全站 `.wb-*` 语义类名（模块级提取一次）。 */
export const WB_CLASSES = extractWbClasses(`${tokensCss}\n${widgetsCss}`);

/**
 * 保存前轻校验（**不阻断保存**，只提示）：括号配平 + 注释/字符串感知。
 * 返回问题描述（含「原因 + 怎么修」，D47 口径）或 `null` = 没发现问题。
 */
export function lintCss(text: string): string | null {
  let depth = 0;
  let line = 1;
  let inComment = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\n") line++;
    if (inComment) {
      if (c === "*" && next === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "*") {
      inComment = true;
      i++;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth < 0) return `第 ${line} 行多了一个 }：检查是否粘贴重复了结束括号`;
    }
  }
  if (inComment) return "注释没有闭合（缺少 `*/`）：补上结束标记";
  if (quote) return "引号没有闭合：检查字符串是否少了收尾引号";
  if (depth > 0) return `还有 ${depth} 个 { 没有闭合：补上结束括号再保存`;
  return null;
}
