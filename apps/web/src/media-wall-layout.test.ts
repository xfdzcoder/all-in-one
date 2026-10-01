import { describe, expect, it } from "vitest";
import { countCells, packRows } from "./media-wall-layout.ts";

const EPS = 1e-6;

/** 造一批比例混合的照片（横/竖/方都有）。 */
function photos(n: number): Array<{ id: string; ratio: number }> {
  const ratios = [1.5, 0.67, 1, 1.78, 0.75, 1.33, 1, 0.56];
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, ratio: ratios[i % ratios.length] as number }));
}

describe("packRows（D61 等高行 justified 装箱，Q89）", () => {
  it("行内**严格等高**；宽度**严格正比于原始比例**（不裁切不变形）", () => {
    const rows = packRows(photos(40), 800, 150, 4);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const heights = new Set(row.cells.map((c) => c.height));
      expect(heights.size).toBe(1); // 同一行内高度完全一致
      for (const c of row.cells) {
        expect(c.width / c.ratio).toBeCloseTo(c.height, 6); // 宽 = 高 × 比例 ⇒ 等比
      }
    }
  });

  it("非末行**恰好铺满容器宽度**（含间隙），末行为自然尺寸左对齐**不拉伸**", () => {
    const W = 800;
    const gap = 4;
    const H0 = 150;
    const rows = packRows(photos(40), W, H0, gap);
    rows.forEach((row, i) => {
      const gaps = gap * (row.cells.length - 1);
      const used = row.cells.reduce((s, c) => s + c.width, 0) + gaps;
      if (i < rows.length - 1) {
        expect(row.filled).toBe(true);
        expect(used).toBeCloseTo(W, 6); // 铺满
      } else {
        expect(row.filled).toBe(false);
        expect(used).toBeLessThanOrEqual(W + EPS); // 不溢出
        expect(row.height).toBeLessThanOrEqual(H0 + EPS); // 不拉伸到目标以上
      }
    });
  });

  it("不丢任何一项（顺序保持）", () => {
    const items = photos(37);
    const rows = packRows(items, 640, 120, 6);
    expect(countCells(rows)).toBe(items.length);
    expect(rows.flatMap((r) => r.cells.map((c) => c.id))).toEqual(items.map((i) => i.id));
  });

  it("行高在目标行高附近（断行取「更贴近目标」，把浮动压到最小）", () => {
    const rows = packRows(photos(60), 800, 150, 4).filter((r) => r.filled);
    for (const row of rows) {
      // 容差：比例混合下不可能行行精确 150（见模块文档的数学说明），但应受控
      expect(row.height).toBeGreaterThan(150 * 0.7);
      expect(row.height).toBeLessThan(150 * 1.5);
    }
  });

  it("末行只有一项也不溢出容器（超宽图压到刚好放下）", () => {
    const rows = packRows([{ id: "wide", ratio: 20 }], 800, 150, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filled).toBe(false);
    expect(rows[0]?.cells[0]?.width).toBeCloseTo(800, 6);
    expect(rows[0]?.height).toBeCloseTo(40, 6); // 800/20 —— 自然尺寸，不拉伸到 150
  });

  it("目标行高越大 → 每行项数越少；越小 → 越多（响应式正确）", () => {
    const wide = packRows(photos(30), 800, 200, 4);
    const narrow = packRows(photos(30), 800, 60, 4);
    expect(wide[0]?.cells.length).toBeLessThan(narrow[0]?.cells.length as number);
  });

  it("容器宽度变化（ResizeObserver 触发重算）结果自洽", () => {
    for (const w of [320, 500, 800, 1200, 1600]) {
      const rows = packRows(photos(24), w, 120, 4);
      expect(countCells(rows)).toBe(24);
      rows.forEach((row, i) => {
        const gaps = 4 * (row.cells.length - 1);
        const used = row.cells.reduce((s, c) => s + c.width, 0) + gaps;
        expect(used).toBeLessThanOrEqual(w + EPS);
        if (i < rows.length - 1) expect(used).toBeCloseTo(w, 6);
      });
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

  it("单张图独占一行时按容器宽度收窄（不溢出）", () => {
    const rows = packRows([{ id: "only", ratio: 3 }], 300, 150, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells[0]?.width).toBeLessThanOrEqual(300 + EPS);
    expect(rows[0]?.cells[0]?.width / (rows[0]?.cells[0]?.ratio as number)).toBeCloseTo(
      rows[0]?.height as number,
      6,
    );
  });
});
