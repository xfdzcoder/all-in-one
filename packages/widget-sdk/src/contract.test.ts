import { describe, expect, it } from "vitest";

import {
  isSecretRef,
  validateConfigSchema,
  validateManifest,
  type WidgetManifest,
} from "./index.ts";

const todoManifest: WidgetManifest = {
  type: "todo",
  name: "个人 Todo",
  category: "数据",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  configSchema: [
    { key: "listId", label: "清单", type: "select", options: [{ value: "inbox", label: "收件箱" }] },
    { key: "filter", label: "过滤", type: "text", default: "open" },
  ],
  capabilities: {
    data: { source: "workspace", resource: "todo" },
    refresh: { minRefreshSec: 10, defaultRefreshSec: 60, supportsManualRefresh: true },
    actions: [
      { name: "todo.toggle", label: "完成/取消" },
      { name: "todo.create", label: "新增", params: [{ key: "title", label: "标题", type: "text", required: true }] },
    ],
    detail: true,
  },
};

describe("widget-sdk contract (FR-W1/W2)", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(todoManifest)).toEqual([]);
  });

  it("rejects manifest without type/name/data capability", () => {
    const bad = { ...todoManifest, type: "", name: "" } as WidgetManifest;
    const errors = validateManifest({ ...bad, capabilities: { data: undefined as never } });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects minSize larger than defaultSize", () => {
    const errors = validateManifest({
      ...todoManifest,
      minSize: { w: 99, h: 99 },
    });
    expect(errors.some((e) => e.includes("minSize"))).toBe(true);
  });

  it("validates configSchema (dup keys, select without options)", () => {
    expect(validateConfigSchema(todoManifest.configSchema)).toEqual([]);
    const errors = validateConfigSchema([
      { key: "a", label: "A", type: "text" },
      { key: "a", label: "A2", type: "text" },
      { key: "s", label: "S", type: "select" },
    ]);
    expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    expect(errors.some((e) => e.includes("select requires options"))).toBe(true);
  });

  it("secret refs are recognized (SEC3: never plaintext in config)", () => {
    expect(isSecretRef({ credentialRef: "cred_1" })).toBe(true);
    expect(isSecretRef({ token: "sk-xxx" })).toBe(false);
    expect(isSecretRef(null)).toBe(false);
    // secret fields store refs, not values
    const schema = [{ key: "apiToken", label: "Token", type: "secret" as const }];
    expect(validateConfigSchema(schema)).toEqual([]);
    expect(isSecretRef({ credentialRef: "cred_2" })).toBe(true);
  });

  // Q72/D57：dependsOn —— 动态选项依赖另一字段（相册/艺人清单随「数据连接」变化）
  it("dependsOn must reference another declared field (D57)", () => {
    const good = [
      { key: "sourceId", label: "数据连接", type: "select" as const, dynamic: "data-source:immich" },
      { key: "albumId", label: "只看相册", type: "select" as const, dynamic: "immich-albums", dependsOn: "sourceId" },
    ];
    expect(validateConfigSchema(good)).toEqual([]);
    // 指向未声明字段 / 指向自身 → 拒绝（宿主无从取依赖值）
    expect(validateConfigSchema([{ key: "albumId", label: "相册", type: "select" as const, dynamic: "immich-albums", dependsOn: "nope" }])).toContain(
      "field albumId: dependsOn references unknown field nope",
    );
    expect(
      validateConfigSchema([{ key: "albumId", label: "相册", type: "select" as const, dynamic: "immich-albums", dependsOn: "albumId" }]),
    ).toContain("field albumId: dependsOn must reference another field");
  });

  it("select may take options from `dynamic` instead of a static list (D57)", () => {
    expect(
      validateConfigSchema([
        { key: "sourceId", label: "数据连接", type: "select" as const, dynamic: "data-source:navidrome" },
        { key: "artistId", label: "只看艺人", type: "select" as const, dynamic: "navidrome-artists", dependsOn: "sourceId" },
      ]),
    ).toEqual([]);
  });
});
