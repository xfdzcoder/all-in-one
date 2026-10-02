import { describe, expect, it } from "vitest";

import { validateConfigSchema, type ConfigSchema } from "./config.ts";

/** TST-4：validateConfigSchema 的规则此前只被 contract.test.ts 间接覆盖 —— 逐规则直测。 */

describe("validateConfigSchema（TST-4 针对性用例）", () => {
  it("合法 schema 零错误（含 dynamic/dependsOn 组合）", () => {
    const schema: ConfigSchema = [
      { key: "sourceId", label: "连接", type: "select", dynamic: "data-source:immich" },
      { key: "albumId", label: "相册", type: "select", dynamic: "immich-albums", dependsOn: "sourceId" },
      { key: "limit", label: "张数", type: "number", default: 12 },
    ];
    expect(validateConfigSchema(schema)).toEqual([]);
  });

  it("缺 key / 缺 label 报错", () => {
    const errs = validateConfigSchema([{ key: "", label: "", type: "text" }]);
    expect(errs).toContain("field missing key");
    expect(errs.some((e) => e.includes("missing label"))).toBe(true);
  });

  it("重复 key 报错", () => {
    const errs = validateConfigSchema([
      { key: "a", label: "A", type: "text" },
      { key: "a", label: "A2", type: "text" },
    ]);
    expect(errs).toContain("duplicate field key: a");
  });

  it("select 必须带 options 或 dynamic", () => {
    expect(validateConfigSchema([{ key: "m", label: "M", type: "select" }])).toContain("field m: select requires options");
    expect(
      validateConfigSchema([{ key: "m", label: "M", type: "select", options: [{ value: "x", label: "X" }] }]),
    ).toEqual([]);
  });

  it("dependsOn 必须指向同 schema 的**其它**字段（D57）", () => {
    expect(
      validateConfigSchema([{ key: "a", label: "A", type: "select", dynamic: "x", dependsOn: "ghost" }]),
    ).toContain("field a: dependsOn references unknown field ghost");
    expect(
      validateConfigSchema([{ key: "a", label: "A", type: "select", dynamic: "x", dependsOn: "a" }]),
    ).toContain("field a: dependsOn must reference another field");
  });
});
