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

export type SwipeState = { acc: number; lastAt: number; fired: boolean };

/** 触发阈值（px）：普通鼠标一格 ≈100–120 → 恰好一页；触控板轻扫也够，但不连跳。 */
const SWIPE_THRESHOLD = 100;
/** 手势边界（ms）：事件间隔超过它 = 新手势（有意的「再来一下」）；连续流（含惯性尾巴）= 同一手势。 */
const SWIPE_GESTURE_GAP_MS = 300;

/**
 * 纯函数：横滑手势状态机（Q121 调参 —— 用户反馈「滚一次切两页」太灵敏）。
 *
 * **一次手势最多切一页**：同一串连续事件流（含触控板/高分辨率滚轮的惯性尾巴）触发一次后，
 * 余量全部吞掉；停顿 >`gestureGapMs` 才算新手势、才能切下一页。
 * （此前每累积 60px 就触发一次，高分辨率滚轮一格被拆成多个小事件 → 一格切好几页。）
 */
export function accumulateSwipe(
  state: SwipeState,
  delta: number,
  now: number,
  opts: { threshold?: number; gestureGapMs?: number } = {},
): { state: SwipeState; fire: -1 | 0 | 1 } {
  const threshold = opts.threshold ?? SWIPE_THRESHOLD;
  const gap = opts.gestureGapMs ?? SWIPE_GESTURE_GAP_MS;
  const sameGesture = now - state.lastAt <= gap;
  const fired = sameGesture && state.fired;
  const acc = (sameGesture ? state.acc : 0) + delta;
  // 手势内已切过：吞掉余量（含惯性尾巴），但继续记时 —— 尾巴不应被判成新手势
  if (fired) return { state: { acc, lastAt: now, fired: true }, fire: 0 };
  if (acc >= threshold) return { state: { acc: 0, lastAt: now, fired: true }, fire: 1 };
  if (acc <= -threshold) return { state: { acc: 0, lastAt: now, fired: true }, fire: -1 };
  return { state: { acc, lastAt: now, fired }, fire: 0 };
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
