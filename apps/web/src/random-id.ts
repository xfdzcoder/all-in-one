/**
 * 生成 UUID v4 形态的随机 id（**HTTP / HTTPS 行为一致**）。
 *
 * 背景（真机反馈：「添加服务器监控组件会报错 crypto.randomUUID is not a function」）：
 * `crypto.randomUUID()` **只在安全上下文可用**（HTTPS 或 localhost）。用户用 **HTTP** 访问
 * 工作台（内网 IP、未启用 TLS 的域名）时它是 `undefined`，调用即抛 TypeError。
 * 同理 `crypto.subtle` 也只在安全上下文可用；但 `crypto.getRandomValues()` **不受限**。
 *
 * 注意：本地 verify 脚本跑在 `http://localhost:*` —— **localhost 属安全上下文**，
 * 所以这个 bug 复现不了；回归断言必须显式摘掉 `crypto.randomUUID` 来模拟。
 */
export function randomId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  // 降级：用不受安全上下文限制的 getRandomValues 构造 RFC 4122 v4 UUID（随机性等价）
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // 极端兜底（无 Web Crypto）：Math.random 不具密码学强度，仅供生成唯一 id
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 取 UUID 的 hex 主体（无连字符）—— CSP nonce 等场景需要 32 位十六进制。 */
export function randomNonce(): string {
  return randomId().replace(/-/g, "");
}
