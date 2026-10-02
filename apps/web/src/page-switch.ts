/**
 * 横向多页面切换（Q119，用户需求 2026-10-03）——参考 GNOME / Windows 多桌面：
 * 横向滚动/滑动切页，动画「整页缩小凹入 → 平滑换页 → 铺满」，每页滚动位置跨刷新保持。
 *
 * **冲突规则（用户拍板）**：按**指针作用域**判定 —— 事件目标下方有横向滚动条容器
 * （看板列横滚、媒体墙、图表…）就把横滑交给它、不切页；没有才切页。
 * 例：鼠标停在有横滚条的看板上 → 滚动看板；停在无横滚条的看板/空白处 → 切页。
 */

export type XScrollInfo = {
  overflowX: string;
  scrollWidth: number;
  clientWidth: number;
};

/** 纯函数：某元素是否是「吃横滑」的容器（可横向滚动）。 */
export function eatsHorizontalScroll(a: XScrollInfo): boolean {
  const allows = a.overflowX === "auto" || a.overflowX === "scroll" || a.overflowX === "overlay";
  return allows && a.scrollWidth > a.clientWidth + 1;
}

/** 纯函数：祖先链判定 —— 任一祖先吃横滑 → 不切页；全不吃 → 切页。 */
export function shouldSwitchPages(ancestors: XScrollInfo[]): boolean {
  return !ancestors.some(eatsHorizontalScroll);
}

/** DOM → 祖先链描述（含自身，自内向外）。浏览器侧使用（getComputedStyle 需要 DOM）。 */
export function chainOf(el: Element | null, win: Window): XScrollInfo[] {
  const out: XScrollInfo[] = [];
  let cur: Element | null = el;
  while (cur) {
    out.push({
      overflowX: win.getComputedStyle(cur).overflowX,
      scrollWidth: cur.scrollWidth,
      clientWidth: cur.clientWidth,
    });
    cur = cur.parentElement;
  }
  return out;
}

export type SwipeState = { acc: number; lastAt: number };

/**
 * 纯函数：横滑增量累积（触控板惯性会产生大量小 delta）。
 * 手势间歇 >250ms 视为新手势（清累积）；累积越过阈值触发一次切换（-1 前一页 / 1 后一页）。
 */
export function accumulateSwipe(
  state: SwipeState,
  delta: number,
  now: number,
  threshold = 60,
): { state: SwipeState; fire: -1 | 0 | 1 } {
  const fresh = now - state.lastAt > 250;
  const acc = (fresh ? 0 : state.acc) + delta;
  if (acc >= threshold) return { state: { acc: 0, lastAt: now }, fire: 1 };
  if (acc <= -threshold) return { state: { acc: 0, lastAt: now }, fire: -1 };
  return { state: { acc, lastAt: now }, fire: 0 };
}

/* ── 每页滚动位置记忆（跨刷新，localStorage）────────────────────── */

const scrollKey = (dashboardId: string) => `wb-scroll:${dashboardId}`;

/** 保存某页的滚动位置（localStorage 失败静默 —— 隐私模式等场景降级为会话内行为）。 */
export function saveScrollTop(dashboardId: string, top: number): void {
  if (!dashboardId) return;
  try {
    localStorage.setItem(scrollKey(dashboardId), String(Math.max(0, Math.round(top))));
  } catch {
    /* 存不下就算了：切页仍工作，只是不保证滚动位置 */
  }
}

/** 读取某页上次的滚动位置（无记录 = 0）。 */
export function loadScrollTop(dashboardId: string): number {
  try {
    const raw = localStorage.getItem(scrollKey(dashboardId));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
