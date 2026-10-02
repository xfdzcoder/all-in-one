import { describe, expect, it } from "vitest";

import { configForSubmit, normalizeTagIds, resolveSourceConfig, valuesWithDefaults } from "./config-form-utils";

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

describe("resolveSourceConfig（D65，用户反馈⑤：卡片配置优先 + 相对地址拼接）", () => {
  const src = { url: "https://svc.example.com", apiToken: "src-token", authHeader: "X-Src" };

  it("缺省（D42 旧语义）：来源优先、内联回落 —— monitor 等兼容路径不受影响", () => {
    const out = resolveSourceConfig(
      { sourceId: "s1", apiToken: "card-token", authHeader: "" },
      src,
      ["authHeader", "apiToken"],
    );
    expect(out.apiToken).toBe("src-token");
    expect(out.authHeader).toBe("X-Src");
  });

  it("inlineWins：卡片已填 > 来源；空值才回落来源（「不同才需填，填了只覆盖本卡」）", () => {
    const out = resolveSourceConfig(
      { sourceId: "s1", apiToken: "card-token", authHeader: "" },
      src,
      ["authHeader", "apiToken"],
      { inlineWins: true },
    );
    expect(out.apiToken).toBe("card-token"); // 填了 → 覆盖来源（不动来源配置）
    expect(out.authHeader).toBe("X-Src"); // 空 → 回落来源（不必二次填写）
    // 两边都没填
    expect(resolveSourceConfig({ apiToken: "" }, {}, ["apiToken"], { inlineWins: true }).apiToken).toBe("");
  });

  it("resolveRelativeUrl：相对 url 按来源站点地址拼接；绝对 url / 无来源不动", () => {
    const opts = { resolveRelativeUrl: true };
    expect(
      resolveSourceConfig({ url: "/api/stats" }, src, ["apiToken"], opts).url,
    ).toBe("https://svc.example.com/api/stats");
    expect(
      resolveSourceConfig({ url: "https://other.example.com/x" }, src, ["apiToken"], opts).url,
    ).toBe("https://other.example.com/x");
    // 无来源：原样保留（取数层按「原因 + 怎么修」报错）
    expect(resolveSourceConfig({ url: "/api/stats" }, {}, undefined, opts).url).toBe("/api/stats");
    // 来源缺地址：同样原样保留
    expect(resolveSourceConfig({ url: "/api/stats" }, { apiToken: "t" }, undefined, opts).url).toBe("/api/stats");
  });
});

// Q115：编辑态表单显示**生效值** —— 缺失/空字段回填 manifest default（用户要求默认值直接出现在输入框）
describe("valuesWithDefaults（编辑态初值回填默认）", () => {
  const schema = [
    { key: "sandbox", label: "沙箱能力", type: "text" as const, default: "allow-scripts allow-same-origin allow-forms" },
    { key: "url", label: "页面地址", type: "text" as const },
    { key: "limit", label: "条目数", type: "number" as const, default: 10 },
  ];

  it("缺失/空串字段回填 default；已填值原样保留", () => {
    expect(valuesWithDefaults(schema, {})).toEqual({
      sandbox: "allow-scripts allow-same-origin allow-forms",
      url: "",
      limit: 10,
    });
    expect(valuesWithDefaults(schema, { sandbox: "allow-scripts", limit: 3 })).toEqual({
      sandbox: "allow-scripts",
      url: "",
      limit: 3,
    });
  });

  it("空串按未填处理（D23 空 = 回落默认），但不改提交语义", () => {
    expect(valuesWithDefaults(schema, { sandbox: "" }).sandbox).toBe("allow-scripts allow-same-origin allow-forms");
  });
});
