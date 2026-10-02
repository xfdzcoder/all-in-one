import { describe, expect, it } from "vitest";

import { textOf } from "./normalize.ts";

// D68（用户反馈「RSS 的标题和描述解析失败，都是 [object Object]」）：
// fast-xml-parser 对带属性元素解析出 `{ "#text", "@_..." }` 对象，归一必须取文本节点。
describe("textOf（XML 节点文本归一，D68）", () => {
  it("标量：字符串原样、数字/布尔强转、null/undefined 回空串", () => {
    expect(textOf("abc")).toBe("abc");
    expect(textOf(42)).toBe("42");
    expect(textOf(true)).toBe("true");
    expect(textOf(null)).toBe("");
    expect(textOf(undefined)).toBe("");
  });

  it("带属性元素：取 #text（Atom <title type=\"html\"> / RSS <guid isPermaLink> 形态）", () => {
    expect(textOf({ "#text": "Tesla hits a speed bump", "@_type": "html" })).toBe("Tesla hits a speed bump");
    expect(textOf({ "#text": "a-1", "@_isPermaLink": "true" })).toBe("a-1");
  });

  it("纯属性节点/无文本对象回空串（调用方据此回落，如 guid → link）", () => {
    expect(textOf({ "@_href": "http://ex.com/x" })).toBe("");
    expect(textOf({})).toBe("");
  });

  it("数组取首个非空成员（XML 重复元素）；嵌套 #text 递归", () => {
    expect(textOf([{ "#text": "" }, { "#text": "second", "@_rel": "x" }])).toBe("second");
    expect(textOf({ "#text": { "#text": "nested", "@_a": "1" }, "@_b": "2" })).toBe("nested");
  });

  it("不再产出 [object Object]（旧宽松强转对对象的 String() 污染 —— 用户反馈的标题/摘要症状）", () => {
    expect(textOf({ "#text": "hi", "@_type": "html" })).toBe("hi");
    expect(textOf({ "@_type": "html" })).toBe("");
    expect(textOf({ "#text": "hi", "@_type": "html" })).not.toContain("[object");
  });
});
