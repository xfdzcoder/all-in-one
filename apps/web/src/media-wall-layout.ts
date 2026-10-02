/**
 * 媒体墙「等高行」装箱（D62，Q89 / 项 2）。
 *
 * 目标（用户原话）：缩略图**始终等比缩放**，不必每个都一样宽，但**每行的高度要一致**，
 * 卡片再高也不能把缩略图拉长。
 *
 * 由此推导出的四条硬约束：
 *  1. **宽度严格正比于原始宽高比** ⇒ 不裁切、不变形（每格宽 = 行高 × 比例）。
 *  2. **每一行高度完全相同**（全局统一行高，不是只有行内等高）。
 *  3. 任何一行都不超出容器宽度；放不下的项**换行**，行尾**允许右侧留白**。
 *  4. 行高由配置的「目标行高」决定，与卡片高度无关 ⇒ 卡片再高也不拉长缩略图。
 *
 * ⚠️ **为什么行尾会留白（D62 明确接受的取舍）**：在「严格等比」+「所有行严格等高」
 * 两条都满足时，各行占用宽度 = 行高 × 该行比例和，而各行比例和不可能相同 ⇒
 * **不可能各行都恰好铺满容器**。要么右侧留白（D62 采用），要么行高逐行浮动（D61 旧口径）。
 * 用户拍板选前者：宁可右侧留白，也要「每行的高度一致」是字面事实。
 *
 * ⚠️ **超宽图会收窄全局行高**：若某张图宽高比大到「按目标行高会超出容器宽」，只能把
 * 行高降到「最宽一项刚好放下」的高度，否则该格必然溢出。这是几何约束，无法既保持
 * 原比例、又塞进容器、又维持原行高。实测真实照片比例 0.9–2.35，远小于常见
 * `容器宽 / 目标行高`（约 4–8），故此分支在真实数据上不会触发。
 *
 * 纯函数、无 DOM、无 React —— 行高统一性、等比性、不溢出、末行不拉伸全部可单测。
 */

export interface WallRatio {
  id: string;
  /** 原始宽高比（width / height）。非法值按 1:1 处理。 */
  ratio: number;
}

interface WallCell {
  id: string;
  ratio: number;
  /** 最终渲染宽度（px，不含 gap）。 */
  width: number;
  /** 最终渲染高度（px）—— **所有行所有项完全相同**。 */
  height: number;
}

export interface WallRow {
  cells: WallCell[];
  /** 该行行高（px）—— 与其它行**完全相同**。 */
  height: number;
}

/** 浮点比较容差（px）。 */
const EPS = 1e-6;

/** 比例防呆：非法/极端值收敛到 [MIN, MAX]，避免 0 宽或无限宽的格子。 */
function clampRatio(r: number): number {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(n, 0.05), 20);
}

/**
 * 等高行装箱。返回若干行；**每一行高度完全相同**，宽度严格正比于比例。
 *
 * @param items           待排布项（顺序即展示顺序，不重排）
 * @param containerWidth  容器可用宽度（px）；<= 0 返回空数组
 * @param targetRowHeight 目标行高（px，`minCell` 配置的现行语义）
 * @param gap             格子间距（px）
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

  const rs = items.map((it) => ({ id: it.id, ratio: clampRatio(it.ratio) }));
  if (rs.length === 0) return [];

  // **全局统一行高**：目标行高，但不超过「最宽一项刚好放下」的高度（否则该格溢出）。
  // 正是这个全局值让「每行高度一致」成为字面事实，而不是只有行内等高。
  const maxRatio = rs.reduce((m, r) => Math.max(m, r.ratio), 0);
  const height = Math.min(H0, W / maxRatio);
  if (!Number.isFinite(height) || height <= 0) return [];

  const rows: WallRow[] = [];
  let cur: WallCell[] = [];
  let used = 0; // 当前行已占用宽度（含格子间 gap）
  for (const r of rs) {
    const width = r.ratio * height;
    const add = cur.length === 0 ? width : g + width;
    // 放不下就换行 —— 行尾留白是 D62 明确接受的代价，绝不为了填满而改比例或改行高
    if (cur.length > 0 && used + add > W + EPS) {
      rows.push({ height, cells: cur });
      cur = [];
      used = 0;
    }
    cur.push({ id: r.id, ratio: r.ratio, width, height });
    used += add;
  }
  if (cur.length > 0) rows.push({ height, cells: cur });
  return rows;
}

/** 所有格子总数（供测试/渲染核对，避免漏项）。 */
export function countCells(rows: readonly WallRow[]): number {
  return rows.reduce((n, r) => n + r.cells.length, 0);
}
