import { createHash, randomBytes } from "node:crypto";

import { str } from "./normalize.ts";

/**
 * Subsonic 认证：salt+md5(token)（口令不入 URL，D47 日志脱敏基线）。
 * SRV-15 收口：此前 `service.ts` / `navidrome-library.ts` 各复制一份，
 * 且 salt 用 `Math.random()`（非加密随机）、每次调用动态 `import("node:crypto")`。
 * 协议固定 md5（Subsonic 规范如此），此处不改算法。
 */
export async function subsonicAuth(config: Record<string, unknown>): Promise<string> {
  const user = str(config.username) ?? "";
  const pass = str(config.password) ?? "";
  const salt = randomBytes(4).toString("hex");
  const token = createHash("md5").update(pass + salt).digest("hex");
  return `u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=all-in-one&f=json`;
}
