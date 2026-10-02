import { beforeAll, describe, expect, it } from "vitest";

import {
  accumulateSwipe,
  eatsHorizontalScroll,
  loadScrollTop,
  saveScrollTop,
  shouldSwitchPages,
  type SwipeState,
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

// Q121（用户反馈「滚一次切两页」太灵敏）：**一次手势最多切一页**。
describe("accumulateSwipe（手势状态机：一次手势最多一页）", () => {
  const S: SwipeState = { acc: 0, lastAt: 0, fired: false };

  it("单个大 delta 事件 = 一页（鼠标一格 100–120px 触发一次）", () => {
    const r = accumulateSwipe(S, 120, 1000);
    expect(r.fire).toBe(1);
    expect(r.state.fired).toBe(true);
  });

  it("连续小事件（高分辨率滚轮/触控板惯性）累积触发一次后，余量全部吞掉", () => {
    let s: SwipeState = S;
    let fires = 0;
    for (let i = 0; i < 20; i++) {
      const r = accumulateSwipe(s, 30, 1000 + i * 20); // 20 个事件 ×30px = 600px 的一次手势
      s = r.state;
      if (r.fire !== 0) fires++;
    }
    expect(fires).toBe(1); // 修复前会切 ~6 页
  });

  it("同一手势内反向余量也不触发（防误触抖动）", () => {
    const first = accumulateSwipe(S, 120, 1000);
    const second = accumulateSwipe(first.state, -200, 1100);
    expect(first.fire).toBe(1);
    expect(second.fire).toBe(0);
  });

  it("停顿超过手势边界 = 新手势，才能切下一页", () => {
    const first = accumulateSwipe(S, 120, 1000);
    const same = accumulateSwipe(first.state, 120, 1250); // 250ms < 300ms：同一手势
    const next = accumulateSwipe(same.state, 120, 1700); // 停顿 450ms：新手势
    expect(first.fire).toBe(1);
    expect(same.fire).toBe(0);
    expect(next.fire).toBe(1);
  });

  it("反向新手势 = 切上一页（有意的回滑不被吞）", () => {
    const first = accumulateSwipe(S, 120, 1000);
    const back = accumulateSwipe(first.state, -120, 1500);
    expect(back.fire).toBe(-1);
  });

  it("低于阈值的单次轻扫不触发", () => {
    expect(accumulateSwipe(S, 60, 1000).fire).toBe(0);
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
