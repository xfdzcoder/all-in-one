import { describe, expect, it } from "vitest";

import { configForSubmit, normalizeTagIds } from "./config-form-utils";

describe("configForSubmit（WEB-2：空=显式清空，secret 空=不改）", () => {
  const schema = [
    { key: "url", type: "text" },
    { key: "restartAllow", type: "text" },
    { key: "apiToken", type: "secret" },
    { key: "limit", type: "number" },
  ];

  it("文本/数字字段的空串保留（清空语义）", () => {
    const out = configForSubmit(schema, { url: "https://x", restartAllow: "", limit: "" });
    expect(out).toEqual({ url: "https://x", restartAllow: "", limit: "" });
  });

  it("secret 字段的空串剔除（留空=不改，Q27a）", () => {
    const out = configForSubmit(schema, { url: "https://x", apiToken: "" });
    expect(out).toEqual({ url: "https://x" });
  });

  it("secret 字段的 SecretRef 对象保留；undefined 剔除", () => {
    const ref = { credentialRef: "c1" };
    expect(configForSubmit(schema, { apiToken: ref, limit: undefined })).toEqual({ apiToken: ref });
  });
});

describe("normalizeTagIds（WEB-5：查询与刷新同一份清洗）", () => {
  it("非数组/空串/混型都归一", () => {
    expect(normalizeTagIds("")).toEqual([]);
    expect(normalizeTagIds(undefined)).toEqual([]);
    expect(normalizeTagIds(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(normalizeTagIds(["a"])).toEqual(["a"]);
  });
});
