/**
 * 媒体墙「等高行 justified」装箱（D61，Q89）。
 *
 * 目标（用户原话）：缩略图**始终等比缩放**，不必每个都一样宽，但**每行的高度要一致**，
 * 卡片再高也不能把缩略图拉长。
 *
 * 由此推导出的三条硬约束：
 *  1. **宽度严格正比于原始宽高比** ⇒ 不裁切、不变形（每格宽 = 行高 × 比例）。
 *  2. **行内严格等高**：行高 = (容器宽 − 间隙) / 该行比例和 —— 由 1 直接推出。
 *  3. **末行按目标行高自然尺寸、左对齐，绝不拉伸**。
 *
 * ⚠️ **一个数学上的事实（诚实说明，不要当 bug 报）**：在「严格等比」+「非末行恰好铺满
 * 容器宽度」两条都满足的前提下，**行与行的高度不可能完全相同** —— 除非允许每行右侧留白。
 * 因为行高 = 容器宽 / 该行比例和，而各行比例和不可能都一样。本实现按 Flickr/Google 相册
 * 的经典 justified 口径取舍：**宁可行高在目标附近小幅浮动，也要每行恰好铺满宽度**；断行点
 * 取「加入下一项后行高偏离目标更远」处，从而把浮动压到最小。若确需行间绝对等高，
 * 改成「固定行高 + 允许右侧留白」即可（同一套 API，加个模式开关）。
 *
 * 纯函数、无 DOM、无 React —— 断行点、等比性、等高性、末行不拉伸全部可单测。
 */

export interface WallRatio {
  id: string;
  /** 原始宽高比（width / height）。非法值按 1:1 处理。 */
  ratio: number;
}

export interface WallCell {
  id: string;
  ratio: number;
  /** 最终渲染宽度（px，不含 gap）。 */
  width: number;
  /** 最终渲染高度（px）—— **同一行内所有项完全相同**。 */
  height: number;
}

export interface WallRow {
  cells: WallCell[];
  /** 该行行高（px）。 */
  height: number;
  /**
   * 该行是否**恰好铺满容器宽度**。
   * 非末行恒为 true；末行为 false（自然尺寸左对齐，不拉伸）。
   */
  filled: boolean;
}

/** 比例防呆：非法/极端值收敛到 [MIN, MAX]，避免 0 宽或无限宽的格子。 */
function clampRatio(r: number): number {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(n, 0.05), 20);
}

/**
 * 等高行装箱。返回若干行；每行内高度严格相同、宽度严格正比于比例。
 *
 * @param items          待排布项（顺序即展示顺序）
 * @param containerWidth 容器可用宽度（px，含 gap 的外框宽）；<= 0 返回空数组
 * @param targetRowHeight 目标行高（px，即 `minCell` 配置的新语义）
 * @param gap            格子间距（px）
 */
export function packRows(
  items: readonly WallRatio[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): WallRow[] {
  const W = Number(containerWidth);
  const H0 = Number(targetRowHeight);
  const g = Math.max(0, Number(gap) || 0);
  if (!Number.isFinite(W) || W <= 0) return [];
  if (!Number.isFinite(H0) || H0 <= 0) return [];

  const rows: WallRow[] = [];
  let cur: Array<{ id: string; ratio: number }> = [];
  let sum = 0;

  /** 封行：`filled=true` 时按「恰好铺满宽度」反推行高，否则按目标行高（末行）。 */
  const close = (filled: boolean): void => {
    if (cur.length === 0) return;
    const gaps = g * (cur.length - 1);
    const naturalHeight = sum > 0 ? (W - gaps) / sum : H0;
    // 末行也**不能溢出容器**（单张超宽图），超出就压到刚好放下 —— 仍是自然尺寸，不拉伸
    const height = filled ? naturalHeight : Math.min(H0, naturalHeight);
    rows.push({
      height,
      filled,
      cells: cur.map((it) => ({ id: it.id, ratio: it.ratio, width: it.ratio * height, height })),
    });
    cur = [];
    sum = 0;
  };

  for (const it of items) {
    const r = clampRatio(it.ratio);
    if (cur.length > 0) {
      const gapsIfAdded = g * cur.length; // cur.length 项 → 再加一项有 cur.length 个间隙
      const heightIfAdded = (W - gapsIfAdded) / (sum + r);
      const gapsNow = g * (cur.length - 1);
      const heightNow = sum > 0 ? (W - gapsNow) / sum : H0;
      // Flickr 口径：取「更贴近目标行高」的那一种断法，把行高浮动压到最小
      if (Math.abs(heightIfAdded - H0) >= Math.abs(heightNow - H0)) {
        close(true);
      }
    }
    cur.push({ id: it.id, ratio: r });
    sum += r;
  }
  close(false); // 末行：自然尺寸左对齐，**不拉伸**
  return rows;
}

/** 所有格子总数（供测试/渲染核对，避免漏项）。 */
export function countCells(rows: readonly WallRow[]): number {
  return rows.reduce((n, r) => n + r.cells.length, 0);
}
