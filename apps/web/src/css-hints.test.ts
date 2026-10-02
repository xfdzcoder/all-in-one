import { describe, expect, it } from "vitest";

import { extractCssVars, extractWbClasses, lintCss } from "./css-hints";

// FR-S3（Q111/D70）：CSS 编辑器的提示数据源来自真实样式表（?raw 提取）。
// 这里只测**提取规则**（纯函数）；「真实样式表 → 提示真的出现」由 verify-css 真机断言
// （vitest 下 `?raw` 的 CSS 被 stub 成空串，管道全链路只能在浏览器里验）。
describe("css-hints（令牌/类名提取）", () => {
  it("提取 --wb-* 自定义属性声明", () => {
    const css = ":root { --wb-color-accent: red; --wb-space-2: 8px; --other: 1; }\n.x { --wb-color-accent: blue; }";
    expect(extractCssVars(css)).toEqual(["--wb-color-accent", "--wb-space-2"]);
  });

  it("提取 .wb-* 语义类名（非 wb 类忽略）", () => {
    const css = ".wb-settings__item {} .wb-alert {} .other-class {} .wb-settings__item {}";
    expect(extractWbClasses(css)).toEqual(["wb-alert", "wb-settings__item"]);
  });

  it("真实样式表能提出令牌与类名 —— 见 verify-css 真机断言（管道全链路）", () => {
    // 形态守卫：导出的数据源永远是数组（浏览器/构建下由 ?raw 填充，vitest 下为空）
    expect(Array.isArray(extractCssVars(":root{}"))).toBe(true);
    expect(Array.isArray(extractWbClasses(".wb-x{}"))).toBe(true);
  });
});

describe("css-hints · lintCss（保存前轻校验）", () => {
  it("合法 CSS 无告警", () => {
    expect(lintCss(":root { --wb-x: 1; }\n.a { color: red; }")).toBeNull();
  });

  it("未闭合块 / 多余右括号 / 未闭合注释与引号 —— 都给原因+怎么修", () => {
    expect(lintCss(".a { color: red;")).toContain("没有闭合");
    expect(lintCss(".a {} }")).toContain("多了一个");
    expect(lintCss("/* comment")).toContain("注释没有闭合");
    expect(lintCss('.a { content: "oops; }')).toContain("引号没有闭合");
  });

  it("注释/字符串里的括号不参与配平", () => {
    expect(lintCss("/* { */ .a { content: \"}\"; }")).toBeNull();
  });
});
