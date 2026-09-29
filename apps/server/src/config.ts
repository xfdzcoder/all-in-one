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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  /** libsql local file path; override for tests / Docker volume.
   *  Resolved to an absolute `file:` URL at load (D20-④). */
  databaseUrl: normalizeFileUrl(process.env.DATABASE_URL ?? "file:./data/app.db"),
} as const;
