import { describe, expect, it } from "vitest";

import { validateManifest } from "./manifest.ts";
import { validatePluginManifest } from "./plugin.ts";

/** TST-4：manifest/plugin 校验规则此前只被 contract.test.ts 间接覆盖 —— 逐规则直测。 */

const base = () => ({
  type: "demo",
  name: "演示",
  defaultSize: { w: 4, h: 3 },
  configSchema: [],
  capabilities: { data: { source: "workspace", resource: "todo" } },
});

describe("validateManifest（TST-4 / SDK-2 / SDK-3）", () => {
  it("合法 manifest 零错误", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  it("SDK-2：入参是不可信 JSON（unknown）—— null/非对象不崩", () => {
    expect(validateManifest(null)).toEqual(["manifest must be an object"]);
    expect(validateManifest("x")).toEqual(["manifest must be an object"]);
  });

  it("缺 type/name、缺 defaultSize、缺 data 能力逐项报错", () => {
    const errs = validateManifest({ configSchema: [] });
    expect(errs).toContain("missing type");
    expect(errs.some((e) => e.includes("missing name"))).toBe(true);
    expect(errs.some((e) => e.includes("defaultSize"))).toBe(true);
    expect(errs.some((e) => e.includes("missing data capability"))).toBe(true);
  });

  it("minSize 不得大于 defaultSize", () => {
    const errs = validateManifest({ ...base(), minSize: { w: 99, h: 99 } });
    expect(errs.some((e) => e.includes("minSize larger"))).toBe(true);
  });

  it("SDK-3：configSchema 必填且逐规则校验（缺/坏不得过安装校验）", () => {
    expect(validateManifest({ ...base(), configSchema: undefined }).some((e) => e.includes("configSchema must be an array"))).toBe(true);
    const errs = validateManifest({ ...base(), configSchema: [{ key: "m", label: "M", type: "select" }] });
    expect(errs.some((e) => e.includes("demo: field m: select requires options"))).toBe(true);
  });
});

describe("validatePluginManifest（TST-4）", () => {
  const pluginBase = () => ({
    ...base(),
    plugin: { entry: "widget.js", apiVersion: "1.0.0" },
  });

  it("合法插件 manifest 零错误", () => {
    expect(validatePluginManifest(pluginBase())).toEqual([]);
  });

  it("缺 plugin 块 / entry 非法 / apiVersion 非 semver 逐项报错", () => {
    expect(validatePluginManifest(base()).some((e) => e.includes("missing plugin block"))).toBe(true);
    expect(
      validatePluginManifest({ ...base(), plugin: { entry: "../evil.js", apiVersion: "1.0.0" } }).some((e) =>
        e.includes("must be a relative module path"),
      ),
    ).toBe(true);
    expect(
      validatePluginManifest({ ...base(), plugin: { entry: "widget.js", apiVersion: "v1" } }).some((e) =>
        e.includes("must be semver"),
      ),
    ).toBe(true);
  });

  it("permissions 未知键 / 非字符串列表报错", () => {
    expect(
      validatePluginManifest({ ...base(), plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { hack: [] } } }).some(
        (e) => e.includes("unknown plugin.permissions.hack"),
      ),
    ).toBe(true);
    expect(
      validatePluginManifest({
        ...base(),
        plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { apis: ["ok", ""] } },
      }).some((e) => e.includes("must be a list of non-empty strings")),
    ).toBe(true);
  });
});
