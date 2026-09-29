import path from "node:path";
import { fileURLToPath } from "node:url";

/** Normalize a `file:` URL to an absolute path form, resolving relative paths against CWD.
 *  BUGFIX (retro): `fileURLToPath("file:./data/app.db")` yields `/data/app.db` (root!), while
 *  libsql treats `file:./x` as CWD-relative — the two must be reconciled here. */
export function normalizeFileUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const raw = url.slice("file:".length).replace(/^\/\//, "");
  // Accept both `file:/abs` and `file:rel/path` forms; always produce `file:/abs`.
  const abs = raw.startsWith("/") ? raw : path.resolve(process.cwd(), raw);
  return `file:${abs}`;
}

export function fileUrlToPathSafe(url: string): string {
  return fileURLToPath(normalizeFileUrl(url));
}

const databaseUrl = normalizeFileUrl(process.env.DATABASE_URL ?? "file:./data/app.db");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  /** libsql local file path; override for tests / Docker volume.
   *  Resolved to an absolute `file:` URL at load (D20-④). */
  databaseUrl,
  /** 数据目录：DB 所在目录；插件安装目录 = dataDir/plugins（D20-④ 附带）。
   *  getter 动态读取 DATABASE_URL —— 便于测试在 import 后切换（同 allowPrivateOutbound）。 */
  get dataDir(): string {
    const url = normalizeFileUrl(process.env.DATABASE_URL ?? "file:./data/app.db");
    return url.startsWith("file:")
      ? path.dirname(fileUrlToPathSafe(url))
      : path.resolve(process.cwd(), "data");
  },
  /** SEC4 测试/开发逃生阀：放行内网出站目标（默认 false = 拒内网）。
   *  用 getter 动态读取，便于测试在 import 后切换（config 是模块级单例）。 */
  get allowPrivateOutbound(): boolean {
    return process.env.ALLOW_PRIVATE_OUTBOUND === "1";
  },
};
