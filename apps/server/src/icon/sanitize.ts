/**
 * 自定义图标 SVG 净化（Q38b/D45）：上传期剥离脚本向内容，防存储型 XSS。
 * 双层防护之第一层（第二层 = 下发时 CSP sandbox + nosniff，见 routes.ts）。
 * SRV-21：`&#106;avascript:` 这类**数字实体编码**能绕过字面匹配 —— 检视一律先解实体。
 */

const DROP_ELEMENTS = [/<script\b[\s\S]*?<\/script\s*>/gi, /<script\b[^>]*\/>/gi, /<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, /<iframe\b[\s\S]*?<\/iframe\s*>/gi, /<embed\b[^>]*\/?>/gi, /<object\b[\s\S]*?<\/object\s*>/gi];

/** 实体解码（数字 + 少量命名）—— 只用于**检视副本**，不改输出文本本体。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (m, h: string) => {
      const c = Number.parseInt(h, 16);
      return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
    })
    .replace(/&#(\d+);?/g, (m, d: string) => {
      const c = Number.parseInt(d, 10);
      return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
    })
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

const DANGEROUS_URL = /^(?:javascript|vbscript|data:text\/html)/i;

export function sanitizeSvg(raw: string): string {
  let s = raw;
  for (const re of DROP_ELEMENTS) s = s.replace(re, "");
  // 事件处理器属性（onclick/onload/…）
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // 危险 URL（href/xlink:href）：**按属性值解码后判定**（SRV-21，实体编码同样命中）
  s = s.replace(/\s((?:xlink:)?href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, name: string, val: string) => {
    const decoded = decodeEntities(val.replace(/^["']|["']$/g, "")).trim();
    return DANGEROUS_URL.test(decoded) ? ` ${name}=""` : m;
  });
  // 表达式 / 外链导入（IE 时代 expression、@import）
  s = s.replace(/expression\s*\(/gi, "");
  s = s.replace(/@import[^;]*;/gi, "");
  return s;
}

/** 是否仍含脚本向残留（净化后拒绝入库）。检视在**实体解码副本**上做（SRV-21）。 */
export function looksUnsafeSvg(s: string): boolean {
  const d = decodeEntities(s);
  return /<script|on\w+\s*=|javascript:|<foreignObject/i.test(d);
}
