import { normalizeFileUrl, fileUrlToPathSafe } from "./config.ts";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("config file: URL normalization (retro P0 fix)", () => {
  it("resolves relative file: URLs against CWD, not filesystem root", () => {
    const out = normalizeFileUrl("file:./data/app.db");
    expect(out).toBe(`file:${path.resolve(process.cwd(), "./data/app.db")}`);
    expect(out.startsWith("file:/")).toBe(true);
    expect(out).not.toBe("file:/data/app.db");
  });

  it("keeps absolute file: URLs untouched", () => {
    expect(normalizeFileUrl("file:/tmp/x.db")).toBe("file:/tmp/x.db");
  });

  it("passes through non-file URLs (future remote libsql)", () => {
    expect(normalizeFileUrl("libsql://example.com")).toBe("libsql://example.com");
  });

  it("fileUrlToPathSafe matches libsql's relative interpretation", () => {
    const p = fileUrlToPathSafe("file:./data/app.db");
    expect(p).toBe(path.resolve(process.cwd(), "./data/app.db"));
  });
});
