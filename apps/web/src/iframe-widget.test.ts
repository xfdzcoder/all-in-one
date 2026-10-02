import { describe, expect, it } from "vitest";

import { isSameOriginAsHost, resolveSandbox } from "./iframe-widget";

// D67（用户反馈「iframe 里的请求的 Origin 是 null」）：默认沙箱必须含 allow-same-origin，
// 同源地址必须拒绝嵌入（同源 + allow-scripts + allow-same-origin = 绕过沙箱隔离）。
describe("iframe 沙箱策略（D67）", () => {
  it("默认沙箱含 allow-same-origin（框内请求 Origin 不再是 null）", () => {
    expect(resolveSandbox(undefined)).toBe("allow-scripts allow-same-origin");
    // 空串 = 未配置（configSchema 默认值语义，D23），同样回落默认
    expect(resolveSandbox("")).toBe("allow-scripts allow-same-origin");
    expect(resolveSandbox("   ")).toBe("allow-scripts allow-same-origin");
  });

  it("自定义沙箱优先（trim 后生效）", () => {
    expect(resolveSandbox("allow-scripts")).toBe("allow-scripts");
    expect(resolveSandbox("  allow-forms  ")).toBe("allow-forms");
  });

  it("同源判定：同协议+主机+端口才算同源", () => {
    const host = "http://localhost:4173";
    expect(isSameOriginAsHost("http://localhost:4173/", host)).toBe(true);
    expect(isSameOriginAsHost("http://localhost:4173/deep/path?x=1", host)).toBe(true);
    // 端口不同 = 跨源（可嵌）
    expect(isSameOriginAsHost("http://localhost:3000/", host)).toBe(false);
    // 协议不同 = 跨源
    expect(isSameOriginAsHost("https://localhost:4173/", host)).toBe(false);
    // 主机不同 = 跨源
    expect(isSameOriginAsHost("http://127.0.0.1:4173/", host)).toBe(false);
  });

  it("非法 URL 不抛错、按跨源处理（交给禁嵌检测/浏览器报错）", () => {
    expect(isSameOriginAsHost("not a url", "http://localhost:4173")).toBe(false);
    expect(isSameOriginAsHost("", "http://localhost:4173")).toBe(false);
  });
});
