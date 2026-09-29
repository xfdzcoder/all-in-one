import { describe, expect, it } from "vitest";

import {
  isPluginManifest,
  validatePluginManifest,
  type PluginManifest,
  type WidgetManifest,
} from "./index.ts";

const pluginManifest: PluginManifest = {
  type: "hello-plugin",
  name: "Hello 插件",
  category: "插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text", default: "hi" }],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 30, defaultRefreshSec: 300, supportsManualRefresh: true },
  },
  plugin: {
    entry: "dist/widget.js",
    apiVersion: "1.0.0",
    permissions: { apis: ["widgets.data"], credentialKinds: ["http-header"] },
  },
};

describe("plugin ABI contract (FR-W5③/FR-W6/FR-W7, D7)", () => {
  it("accepts a well-formed plugin manifest", () => {
    expect(validatePluginManifest(pluginManifest)).toEqual([]);
  });

  it("accepts minimal permissions (default deny-all extras)", () => {
    const m: PluginManifest = {
      ...pluginManifest,
      plugin: { entry: "index.mjs", apiVersion: "0.1.0" },
    };
    expect(validatePluginManifest(m)).toEqual([]);
  });

  it("rejects missing/absolute/traversal entry paths", () => {
    for (const entry of ["", "/abs/widget.js", "../escape.js", "dist/../x.js", "no-extension"]) {
      const m: PluginManifest = { ...pluginManifest, plugin: { ...pluginManifest.plugin, entry } };
      const errors = validatePluginManifest(m);
      expect(errors.some((e) => e.includes("plugin.entry"))).toBe(true);
    }
  });

  it("rejects non-semver apiVersion", () => {
    for (const apiVersion of ["", "1", "1.0", "v1.0.0", "1.0.0-beta"]) {
      const m: PluginManifest = { ...pluginManifest, plugin: { ...pluginManifest.plugin, apiVersion } };
      const errors = validatePluginManifest(m);
      expect(errors.some((e) => e.includes("apiVersion"))).toBe(true);
    }
  });

  it("rejects unknown permission keys and malformed lists", () => {
    const unknown = validatePluginManifest({
      ...pluginManifest,
      plugin: {
        ...pluginManifest.plugin,
        permissions: { root: ["*"] } as never,
      },
    });
    expect(unknown.some((e) => e.includes("unknown plugin.permissions.root"))).toBe(true);

    const malformed = validatePluginManifest({
      ...pluginManifest,
      plugin: {
        ...pluginManifest.plugin,
        permissions: { apis: ["ok", ""] as string[], credentialKinds: "http-header" as never },
      },
    });
    expect(malformed.some((e) => e.includes("plugin.permissions.apis"))).toBe(true);
    expect(malformed.some((e) => e.includes("plugin.permissions.credentialKinds"))).toBe(true);
  });

  it("still enforces base widget contract", () => {
    const m = { ...pluginManifest, name: "" } as PluginManifest;
    expect(validatePluginManifest(m).some((e) => e.includes("name"))).toBe(true);
  });

  it("isPluginManifest discriminates plugin blocks", () => {
    expect(isPluginManifest(pluginManifest)).toBe(true);
    const plain: WidgetManifest = { ...pluginManifest };
    delete (plain as Partial<PluginManifest>).plugin;
    expect(isPluginManifest(plain)).toBe(false);
  });
});
