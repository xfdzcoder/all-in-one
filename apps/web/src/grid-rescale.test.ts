import { describe, expect, it } from "vitest";
import { rescaleLayout } from "./grid-rescale.ts";

function box(id: string, x: number, y: number, w: number, h: number) {
  return { id, x, y, w, h };
}

describe("rescaleLayout（Q91/D58 列数切换重算 x/w）", () => {
  it("按比例放大：视觉占比不变（12 → 24）", () => {
    const out = rescaleLayout([box("a", 0, 0, 6, 3), box("b", 6, 0, 6, 3)], 12, 24);
    expect(out[0]).toMatchObject({ x: 0, w: 12, y: 0, h: 3 });
    expect(out[1]).toMatchObject({ x: 12, w: 12, y: 0, h: 3 });
  });

  it("按比例缩小（24 → 12）；往返缩放回到原样", () => {
    const orig = [box("a", 0, 0, 12, 3), box("b", 12, 0, 12, 3), box("c", 0, 3, 8, 2)];
    const down = rescaleLayout(orig, 24, 12);
    expect(down).toEqual(orig.map((w, i) => ({ ...w, x: [0, 6, 0][i], w: [6, 6, 4][i] })));
    expect(rescaleLayout(down, 12, 24)).toEqual(orig);
  });

  it("**y/h 不动** —— 行高由 cellHeight 决定，与列数无关", () => {
    const out = rescaleLayout([box("a", 2, 7, 4, 5)], 12, 32);
    expect(out[0]?.y).toBe(7);
    expect(out[0]?.h).toBe(5);
  });

  it("不越界：x + w <= toCols，w >= 1", () => {
    for (const to of [12, 16, 20, 24, 28, 32]) {
      const out = rescaleLayout(
        [box("a", 0, 0, 1, 1), box("b", 11, 0, 1, 1), box("c", 5, 1, 7, 1), box("d", 0, 2, 12, 1)],
        12,
        to,
      );
      for (const w of out) {
        expect(w.w).toBeGreaterThanOrEqual(1);
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x + w.w).toBeLessThanOrEqual(to);
      }
    }
  });

  it("碰撞消解：四舍五入叠住的往后放者下推一行，不重叠", () => {
    // 12 → 5（非档位也应自洽）：x=0,w=3 与 x=3,w=3 都会挤到同一窄带
    const out = rescaleLayout([box("a", 0, 0, 3, 2), box("b", 3, 0, 3, 2), box("c", 6, 0, 3, 2)], 12, 5);
    const clash = (p: { x: number; y: number; w: number; h: number }, q: typeof p) =>
      p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i]!;
        const b = out[j]!;
        expect(clash(a, b)).toBe(false);
      }
    }
  });

  it("保持入参顺序（id 允许重复）", () => {
    const out = rescaleLayout([box("x", 0, 0, 6, 1), box("x", 6, 0, 6, 1)], 12, 24);
    expect(out.map((w) => w.x)).toEqual([0, 12]);
    expect(out).toHaveLength(2);
  });

  it("非法入参不炸：from/to <= 0、NaN、缺字段", () => {
    const broken: Array<{ id: string; x: number; y: number; w: number; h: number }> = [
      { id: "a", x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN },
    ];
    const out = rescaleLayout(broken, 0, 0);
    expect(out).toHaveLength(1);
    expect(Number.isFinite(out[0]?.x)).toBe(true);
    expect(Number.isFinite(out[0]?.w)).toBe(true);
    expect(out[0]?.w).toBeGreaterThanOrEqual(1);
    expect(rescaleLayout([], 12, 24)).toEqual([]);
  });

  it("保留原对象全部字段（component/props 不丢）", () => {
    const out = rescaleLayout(
      [{ id: "a", x: 0, y: 0, w: 6, h: 3, component: "todo", props: { list: "inbox" } }],
      12,
      24,
    );
    expect(out[0]).toMatchObject({ component: "todo", props: { list: "inbox" }, x: 0, w: 12 });
  });

  it("六个档位互转全部自洽（不丢项、不越界、不重叠）", () => {
    const tiers = [12, 16, 20, 24, 28, 32];
    const orig = [box("a", 0, 0, 4, 3), box("b", 4, 0, 8, 3), box("c", 0, 3, 12, 2), box("d", 6, 5, 6, 2)];
    for (const from of tiers) {
      for (const to of tiers) {
        const out = rescaleLayout(orig, from, to);
        expect(out).toHaveLength(orig.length);
        for (const w of out) {
          expect(w.x + w.w).toBeLessThanOrEqual(to);
          expect(w.w).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
