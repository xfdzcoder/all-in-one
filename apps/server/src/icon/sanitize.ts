/**
 * 自定义图标 SVG 净化（Q38b/D45）：上传期剥离脚本向内容，防存储型 XSS。
 * 双层防护之第一层（第二层 = 下发时 CSP sandbox + nosniff，见 routes.ts）。
 */

const DROP_ELEMENTS = [/<script\b[\s\S]*?<\/script\s*>/gi, /<script\b[^>]*\/>/gi, /<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, /<iframe\b[\s\S]*?<\/iframe\s*>/gi, /<embed\b[^>]*\/?>/gi, /<object\b[\s\S]*?<\/object\s*>/gi];

export function sanitizeSvg(raw: string): string {
  let s = raw;
  for (const re of DROP_ELEMENTS) s = s.replace(re, "");
  // 事件处理器属性（onclick/onload/…）
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // javascript:/data:text/html 等危险 URL（href/xlink:href）
  s = s.replace(/\s(?:xlink:)?href\s*=\s*("|')?\s*(?:javascript|data:text\/html)[^"'>]*("|')?/gi, ' href=""');
  // 表达式 / 外链导入（IE 时代 expression、@import）
  s = s.replace(/expression\s*\(/gi, "");
  s = s.replace(/@import[^;]*;/gi, "");
  return s;
}

/** 是否仍含脚本向残留（净化后拒绝入库）。 */
export function looksUnsafeSvg(s: string): boolean {
  return /<script|on\w+\s*=|javascript:|<foreignObject/i.test(s);
}
