import { describe, expect, it } from "vitest";
import { countCells, packRows } from "./media-wall-layout.ts";

const EPS = 1e-6;

/** 造一批比例混合的照片（横/竖/方都有）。 */
function photos(n: number): Array<{ id: string; ratio: number }> {
  const ratios = [1.5, 0.67, 1, 1.78, 0.75, 1.33, 1, 0.56];
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, ratio: ratios[i % ratios.length] as number }));
}

describe("packRows（D62 全局等高行装箱，Q89）", () => {
  it("**每一行高度完全相同**（不只是行内等高）；宽度**严格正比于原始比例**", () => {
    const rows = packRows(photos(40), 800, 150, 4);
    expect(rows.length).toBeGreaterThan(1);
    // 行间等高：所有行的 height 是同一个值
    expect(new Set(rows.map((r) => r.height)).size).toBe(1);
    for (const row of rows) {
      // 行内等高（同一值的自然推论，仍显式断言）
      expect(new Set(row.cells.map((c) => c.height)).size).toBe(1);
      for (const c of row.cells) {
        expect(c.width / c.ratio).toBeCloseTo(c.height, 6); // 宽 = 高 × 比例 ⇒ 等比
        expect(c.height).toBeCloseTo(rows[0]?.height as number, 6);
      }
    }
  });

  it("无超宽图时行高 **== 目标行高**（与卡片高度无关，卡片再高也不拉长）", () => {
    for (const containerHeight of [200, 600, 2000]) {
      void containerHeight; // 行高根本不接收卡片高度 —— 这正是「不拉长」的来源
      const rows = packRows(photos(30), 800, 150, 4);
      expect(rows[0]?.height).toBeCloseTo(150, 6);
    }
  });

  it("任何一行都**不溢出**容器宽度；行尾允许右侧留白（D62 明确接受）", () => {
    const W = 800;
    const rows = packRows(photos(40), W, 150, 4);
    let raggedSeen = 0;
    for (const row of rows) {
      const gaps = 4 * (row.cells.length - 1);
      const used = row.cells.reduce((s, c) => s + c.width, 0) + gaps;
      expect(used).toBeLessThanOrEqual(W + EPS);
      if (used < W - 1) raggedSeen += 1;
    }
    // 留白确实会出现 —— 这就是「严格等高」的代价，别当 bug 修
    expect(raggedSeen).toBeGreaterThan(0);
  });

  it("不丢任何一项（顺序保持）", () => {
    const items = photos(37);
    const rows = packRows(items, 640, 120, 6);
    expect(countCells(rows)).toBe(items.length);
    expect(rows.flatMap((r) => r.cells.map((c) => c.id))).toEqual(items.map((i) => i.id));
  });

  it("超宽图会收窄**全局**行高，但所有行仍严格等高、且不溢出", () => {
    // 800 / 150 ≈ 5.33：插入一个 ratio=10 的全景，行高被迫降到 800/10 = 80
    const rows = packRows([{ id: "a", ratio: 1 }, { id: "pano", ratio: 10 }, { id: "b", ratio: 1 }], 800, 150, 4);
    expect(new Set(rows.map((r) => r.height)).size).toBe(1); // 仍然全等
    expect(rows[0]?.height).toBeCloseTo(80, 6);
    for (const row of rows) {
      const used = row.cells.reduce((s, c) => s + c.width, 0) + 4 * (row.cells.length - 1);
      expect(used).toBeLessThanOrEqual(800 + EPS);
    }
    expect(countCells(rows)).toBe(3);
  });

  it("目标行高越大 → 每行项数越少；越小 → 越多（响应式正确）", () => {
    const wide = packRows(photos(30), 800, 200, 4);
    const narrow = packRows(photos(30), 800, 60, 4);
    expect(wide[0]?.cells.length).toBeLessThan(narrow[0]?.cells.length as number);
  });

  it("容器宽度变化（ResizeObserver 触发重算）结果自洽：全等高 + 不溢出 + 不丢项", () => {
    for (const w of [320, 500, 800, 1200, 1600]) {
      const rows = packRows(photos(24), w, 120, 4);
      expect(countCells(rows)).toBe(24);
      expect(new Set(rows.map((r) => r.height)).size).toBe(1);
      for (const row of rows) {
        const used = row.cells.reduce((s, c) => s + c.width, 0) + 4 * (row.cells.length - 1);
        expect(used).toBeLessThanOrEqual(w + EPS);
      }
    }
  });

  it("非法 ratio（0/负/NaN/Infinity）按 1:1 退化，不破坏整行", () => {
    const rows = packRows(
      [
        { id: "a", ratio: 0 },
        { id: "b", ratio: -3 },
        { id: "c", ratio: Number.NaN },
        { id: "d", ratio: Number.POSITIVE_INFINITY },
        { id: "e", ratio: 1 },
      ],
      800,
      150,
      4,
    );
    expect(countCells(rows)).toBe(5);
    expect(new Set(rows.map((r) => r.height)).size).toBe(1);
    for (const row of rows) {
      for (const c of row.cells) {
        expect(Number.isFinite(c.width)).toBe(true);
        expect(c.width).toBeGreaterThan(0);
      }
    }
  });

  it("空/非法容器参数返回空数组（渲染层据此等 ResizeObserver）", () => {
    expect(packRows([], 800, 150, 4)).toEqual([]);
    expect(packRows(photos(3), 0, 150, 4)).toEqual([]);
    expect(packRows(photos(3), -10, 150, 4)).toEqual([]);
    expect(packRows(photos(3), 800, 0, 4)).toEqual([]);
    expect(packRows(photos(3), Number.NaN, 150, 4)).toEqual([]);
  });

  it("单张图独占一行时刚好铺满容器宽（全局行高 = 宽/比例）", () => {
    const rows = packRows([{ id: "only", ratio: 3 }], 300, 150, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.height).toBeCloseTo(100, 6); // 300/3 —— 目标 150 会溢出，故收窄
    expect(rows[0]?.cells[0]?.width).toBeCloseTo(300, 6);
  });
});
