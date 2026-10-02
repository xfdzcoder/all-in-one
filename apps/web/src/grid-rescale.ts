/**
 * 布局坐标系缩放（Q91 / 项 8 / D58）。
 *
 * `layoutJson` 里的 `x/w` 是**以 dashboard.columns 为分母**的栅格坐标。改列数时必须
 * 按比例重算，否则组件会「占错位置」（12 列下 x=6 是屏幕中间，24 列下 x=6 是左三分之一）。
 *
 * 三条性质：
 *  1. **按比例**：`x` 与 `w` 同乘 `toCols/fromCols`，视觉占比不变。
 *  2. **不越界**：`x + w <= toCols`，`w >= 1`。
 *  3. **碰撞消解**：四舍五入可能让相邻组件叠住，按顺序把后放的往下推到不重叠为止。
 *
 * `y/h` **不动** —— 行高由 `cellHeight` 决定，与列数无关。
 *
 * 纯函数、无 DOM —— 比例、越界、碰撞消解全部可单测。
 */

export interface RescalableWidget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 两个矩形是否在同一行带上有重叠（栅格坐标，含端点相邻不算重叠）。 */
function overlaps(a: RescalableWidget, b: RescalableWidget): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 把布局从 `fromCols` 坐标系缩放到 `toCols` 坐标系。
 * **保留入参对象的其它字段**（`component`/`props` 等），只改 `x/y/w/h`。
 * 入参不变；返回新数组。`fromCols`/`toCols` 非法时按 1 处理。
 */
export function rescaleLayout<T extends RescalableWidget>(
  widgets: readonly T[],
  fromCols: number,
  toCols: number,
): T[] {
  const from = Math.max(1, Math.round(num(fromCols, 1)));
  const to = Math.max(1, Math.round(num(toCols, 1)));

  // 先比例缩放 + 边界钳制
  const scaled = widgets.map((wRaw) => {
    const w0 = Math.max(1, Math.round(num(wRaw.w, 1)));
    const x0 = Math.max(0, Math.round(num(wRaw.x, 0)));
    const y0 = Math.max(0, Math.round(num(wRaw.y, 0)));
    const h0 = Math.max(1, Math.round(num(wRaw.h, 1)));

    let x = Math.round((x0 * to) / from);
    let w = Math.max(1, Math.round((w0 * to) / from));
    // 不越界：先收窄宽度，还放不下就整体左移
    if (w > to) w = to;
    if (x + w > to) x = to - w;
    if (x < 0) x = 0;
    return { w: wRaw, x, y: y0, w2: w, h: h0 };
  });

  // 碰撞消解：按 y、x 排序后逐个放置，压到不与已放置的重叠为止
  const order = scaled.map((s, i) => ({ s, i })).toSorted((a, b) => a.s.y - b.s.y || a.s.x - b.s.x || a.i - b.i);
  const out: T[] = Array.from<T>({ length: scaled.length }); // unicorn(no-new-array)
  const placed: RescalableWidget[] = [];
  for (const { s, i } of order) {
    let cur = { id: s.w.id, x: s.x, y: s.y, w: s.w2, h: s.h };
    // 单调下推；极端情况也不会死循环（每次 y+1，guard 上限宽松）
    let guard = 0;
    while (placed.some((p) => overlaps(p, cur)) && guard < placed.length + scaled.length + 1) {
      cur.y += 1; // oxc(no-accumulating-spread)：局部对象，原地推进即可
      guard += 1;
    }
    placed.push(cur);
    // 按**原下标**回填并保留原对象全部字段（component/props/...）
    out[i] = { ...s.w, x: cur.x, y: cur.y, w: cur.w, h: cur.h };
  }
  return out;
}
