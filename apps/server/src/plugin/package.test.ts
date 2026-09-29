import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { PluginPackageError, PLUGIN_PACKAGE_LIMITS, readPluginPackage } from "./package.ts";

const baseManifest = (over: Record<string, unknown> = {}) => ({
  type: "hello-plugin",
  name: "Hello 插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text" }],
  capabilities: { data: { source: "http-connector" } },
  plugin: { entry: "widget.js", apiVersion: "1.0.0" },
  ...over,
});

const zip = (files: Record<string, string | Uint8Array>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v]),
    ),
  );

const goodPackage = (over: Record<string, unknown> = {}) =>
  zip({
    "manifest.json": JSON.stringify(baseManifest(over)),
    "widget.js": "export default () => null;",
  });

describe("plugin package reader (D24 ABI, SEC 基线)", () => {
  it("reads a valid package", () => {
    const pkg = readPluginPackage(goodPackage());
    expect(pkg.manifest.type).toBe("hello-plugin");
    expect(pkg.files.has("widget.js")).toBe(true);
    expect(pkg.files.has("manifest.json")).toBe(true);
  });

  it("rejects non-zip bytes", () => {
    expect(() => readPluginPackage(strToU8("definitely not a zip"))).toThrow(PluginPackageError);
    expect(() => readPluginPackage(strToU8("definitely not a zip"))).toThrow("invalid zip package");
  });

  it("rejects missing/invalid manifest.json", () => {
    expect(() => readPluginPackage(zip({ "widget.js": "x" }))).toThrow("manifest.json missing");
    expect(() => readPluginPackage(zip({ "manifest.json": "{oops", "widget.js": "x" }))).toThrow(
      "not valid JSON",
    );
  });

  it("rejects manifest contract violations (entry/apiVersion/permissions)", () => {
    expect(() => readPluginPackage(goodPackage({ plugin: { entry: "../evil.js", apiVersion: "1.0.0" } }))).toThrow(
      "plugin.entry",
    );
    expect(() => readPluginPackage(goodPackage({ plugin: { entry: "widget.js", apiVersion: "1.0" } }))).toThrow(
      "apiVersion",
    );
    expect(() =>
      readPluginPackage(
        goodPackage({
          plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { root: ["*"] } },
        }),
      ),
    ).toThrow("unknown plugin.permissions.root");
  });

  it("rejects entry module missing from package", () => {
    expect(() =>
      readPluginPackage(zip({ "manifest.json": JSON.stringify(baseManifest()) })),
    ).toThrow("entry module missing");
  });

  it("rejects unsafe entry names (absolute / traversal / backslash / hidden)", () => {
    for (const badName of ["../evil.js", "/abs.js", "dist/../x.js", "a\\b.js", "dist/.hidden.js"]) {
      expect(() =>
        readPluginPackage(
          zip({
            "manifest.json": JSON.stringify(baseManifest()),
            "widget.js": "x",
            [badName]: "x",
          }),
        ),
      ).toThrow("unsafe entry path");
    }
  });

  it("enforces entry count / entry size / total size limits", () => {
    const files = (n: number) => {
      const out: Record<string, string> = {
        "manifest.json": JSON.stringify(baseManifest()),
        "widget.js": "x",
      };
      for (let i = 0; i < n; i++) out[`res-${i}.txt`] = "y";
      return out;
    };
    expect(() =>
      readPluginPackage(zip(files(3)), {
        ...PLUGIN_PACKAGE_LIMITS,
        maxEntries: 3,
      }),
    ).toThrow("too many entries");
    expect(() =>
      readPluginPackage(goodPackage(), {
        ...PLUGIN_PACKAGE_LIMITS,
        maxEntryBytes: 4,
      }),
    ).toThrow("entry too large");
    expect(() =>
      readPluginPackage(zip(files(2)), {
        ...PLUGIN_PACKAGE_LIMITS,
        maxTotalBytes: 80,
      }),
    ).toThrow("package too large");
  });
});
