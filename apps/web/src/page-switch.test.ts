import { beforeAll, describe, expect, it } from "vitest";

import {
  accumulateSwipe,
  eatsHorizontalScroll,
  loadScrollTop,
  saveScrollTop,
  shouldSwitchPages,
  type XScrollInfo,
} from "./page-switch";

// vitest 跑在 node 环境（无 localStorage）—— 装个内存替身；真实浏览器走 window.localStorage
beforeAll(() => {
  const mem = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});

const box = (overflowX: string, scrollWidth: number, clientWidth: number): XScrollInfo => ({
  overflowX,
  scrollWidth,
  clientWidth,
});

// Q119：横向切页的**冲突规则**（用户拍板「按指针作用域」）——
// 指针下方有横向滚动条容器（看板横滚/媒体墙）→ 滚它不切页；没有 → 切页。
describe("shouldSwitchPages（指针作用域冲突规则）", () => {
  it("下方有可横向滚动的容器 → 不切页", () => {
    expect(shouldSwitchPages([box("auto", 2000, 400)])).toBe(false); // 有横滚条的看板
    expect(shouldSwitchPages([box("scroll", 900, 800), box("auto", 100, 80)])).toBe(false);
  });

  it("下方没有横向滚动条（或已到底不适用）→ 切页", () => {
    expect(shouldSwitchPages([])).toBe(true); // 空白区
    expect(shouldSwitchPages([box("auto", 400, 400)])).toBe(true); // 可滚声明但没内容超出
    expect(shouldSwitchPages([box("hidden", 2000, 400), box("visible", 2000, 400)])).toBe(true);
    expect(shouldSwitchPages([box("auto", 300, 400)])).toBe(true);
  });

  it("纵向滚动容器不算（overflow-y 滚、overflow-x hidden 不吃横滑）", () => {
    expect(eatsHorizontalScroll(box("hidden", 2000, 400))).toBe(false); // .wb-main 就是这种
  });
});

describe("accumulateSwipe（触控板小 delta 累积）", () => {
  it("单次越过阈值才触发，方向按符号", () => {
    let s = { acc: 0, lastAt: 0 };
    let r = accumulateSwipe(s, 30, 1000);
    expect(r.fire).toBe(0);
    s = r.state;
    r = accumulateSwipe(s, 35, 1050);
    expect(r.fire).toBe(1); // 30+35 ≥ 60
    expect(r.state.acc).toBe(0); // 触发后清零
  });

  it("反向累积触发上一页；手势间歇 >250ms 重新开始", () => {
    let r = accumulateSwipe({ acc: 0, lastAt: 0 }, -61, 1000);
    expect(r.fire).toBe(-1);
    r = accumulateSwipe({ acc: 50, lastAt: 0 }, -10, 3000); // 新手势：累积清零，不触发
    expect(r.fire).toBe(0);
    expect(r.state.acc).toBe(-10);
  });
});

describe("滚动位置记忆（跨刷新，localStorage）", () => {
  it("存取往返 + 非法值回 0", () => {
    saveScrollTop("dash-1", 1234.5);
    expect(loadScrollTop("dash-1")).toBe(1235);
    saveScrollTop("dash-2", -5);
    expect(loadScrollTop("dash-2")).toBe(0);
    expect(loadScrollTop("dash-none")).toBe(0);
    expect(loadScrollTop("")).toBe(0);
  });
});
