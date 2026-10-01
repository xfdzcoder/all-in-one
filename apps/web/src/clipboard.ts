/**
 * 复制文本到剪贴板（**HTTP / HTTPS 行为一致**）。
 *
 * `navigator.clipboard` **只在安全上下文可用**（HTTPS 或 localhost）——
 * 用 HTTP 访问工作台时它是 `undefined`，直接 `navigator.clipboard.writeText(...)`
 * 会同步抛 `Cannot read properties of undefined (reading 'writeText')`
 * （`.catch()` 只能接住 promise 的 rejection，接不住这种同步抛）。
 *
 * 降级链：Web Clipboard API → 传统 `document.execCommand("copy")` → 返回 false（调用方提示失败）。
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* 权限/焦点问题 → 走降级 */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
