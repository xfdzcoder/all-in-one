import { describe, expect, it } from "vitest";

import { formatRelative } from "./ui";

// TST-1（Q100g）：formatRelative 边界（WEB-9 崩卡回归的纯函数面）
describe("formatRelative（相对时间边界）", () => {
  it("非法时间返回空串（不抛；RelativeTime 侧回退「—」）", () => {
    expect(formatRelative("")).toBe("");
    expect(formatRelative("not-a-date")).toBe("");
    expect(formatRelative(NaN)).toBe("");
  });

  it("分钟/小时/天/日期四档", () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 5_000))).toBe("刚刚");
    expect(formatRelative(new Date(now - 5 * 60_000))).toBe("5 分钟前");
    expect(formatRelative(new Date(now - 3 * 3_600_000))).toBe("3 小时前");
    expect(formatRelative(new Date(now - 2 * 86_400_000))).toBe("2 天前");
    expect(formatRelative(new Date(now - 40 * 86_400_000))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("接受字符串与时间戳输入", () => {
    const t = Date.now() - 60 * 60_000;
    expect(formatRelative(new Date(t).toISOString())).toBe("1 小时前");
    expect(formatRelative(t)).toBe("1 小时前");
  });
});
