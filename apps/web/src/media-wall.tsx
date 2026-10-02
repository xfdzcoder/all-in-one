import { UnstyledButton } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { packRows } from "./media-wall-layout";

/**
 * 媒体墙（Q71，Immich 照片墙 / Navidrome 专辑墙共用）。
 *
 * Q89（项 2，D60/D61/**D62**）三条要求：
 *  1. **始终等比缩放**：每格宽 = 行高 × 原始宽高比 —— 不裁切、不变形。
 *  2. **每行高度一致**：D62 起是**全局统一行高**（不是只有行内等高）。宽度按各自
 *     原比例不同、不必等宽；行尾**允许右侧留白**（这是「严格等高」的几何代价）。
 *     卡片再高也不拉长缩略图（行高由配置的目标行高决定，与卡片高度无关）。
 *  3. 任何一行都不超出容器宽度。
 *
 * 布局算法在 `media-wall-layout.ts`（纯函数，可单测）；本组件只负责**量宽 + 渲染**。
 * 容器宽度经 `ResizeObserver` 实测，变化即重算（响应式）。
 *
 * 样式全走 `.wb-gallery*` 语义类（D39：类名即公共 API，可被 /custom.css 覆盖）。
 */

export interface MediaWallItem {
  id: string;
  /** 图片 data URI；**空字符串 = 不可用**（渲染占位块）。 */
  src: string;
  /** 悬浮提示（无障碍 title）。 */
  title?: string;
  /** 叠加角标（如「视频」）。 */
  badge?: ReactNode;
  /** 占位块的图标与文案。 */
  placeholder: { icon: ReactNode; label: string };
  /** 原始宽高（D60 §1：服务端从缩略图**字节头**解析）；缺省按 1:1 退化。 */
  width?: number;
  height?: number;
}

/** 宽高比：取不到/非法一律 1:1（占位块、抓取失败项不破坏整行）。 */
function ratioOf(it: MediaWallItem): number {
  const w = Number(it.width);
  const h = Number(it.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

/**
 * 是否**拿到真实宽高**。注意不能用 `ratioOf(it) !== 1` 判断 —— 300×300 的正方形
 * 比例也是 1，但它是已知比例，不该退化成 fallback 格子。
 */
function hasKnownRatio(it: MediaWallItem): boolean {
  const w = Number(it.width);
  const h = Number(it.height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}

export function MediaWall({
  items,
  layout = "grid",
  randomIntervalSec = 30,
  targetRowHeight = 72,
  onOpen,
}: {
  items: MediaWallItem[];
  /** `grid` 铺开（默认）/ `random` 随机单图。 */
  layout?: "grid" | "random";
  /** 随机模式的换图间隔（秒）。 */
  randomIntervalSec?: number;
  /** **目标行高**（px）—— D60 §3：`minCell` 配置的语义已从「格子最小边长」改为目标行高。 */
  targetRowHeight?: number;
  onOpen: (item: MediaWallItem, index: number) => void;
}) {
  // 随机模式：当前展示下标（items 变化时重掷；定时随机换一张，避免连续重复）
  const [randIdx, setRandIdx] = useState(0);
  const count = items.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (layout !== "random") return;
    if (prevCount.current !== count) {
      prevCount.current = count;
      setRandIdx(count > 0 ? Math.floor(Math.random() * count) : 0);
    }
  }, [layout, count]);
  useEffect(() => {
    if (layout !== "random" || count < 2) return;
    const ms = Math.max(3, Number(randomIntervalSec) || 30) * 1000;
    const timer = setInterval(() => {
      setRandIdx((cur) => {
        if (count < 2) return cur;
        let next = Math.floor(Math.random() * count);
        if (next === cur) next = (next + 1) % count; // 不连续重复同一张
        return next;
      });
    }, ms);
    return () => clearInterval(timer);
  }, [layout, count, randomIntervalSec]);

  // ── 装箱：量宽 → packRows → 按 px 渲染 ──
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, gap: 4 });
  useEffect(() => {
    if (layout !== "grid") return;
    const el = hostRef.current;
    if (!el) return;
    const measure = (): void => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap || cs.gap);
      setBox({ w: el.clientWidth, gap: Number.isFinite(gap) ? gap : 4 });
    };
    measure();
    // 容器宽度变化（窗口缩放 / 卡片缩放 / 栅格断点）即重算 —— 这就是「完全响应式」
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  const rows = useMemo(() => {
    if (layout !== "grid") return [];
    return packRows(
      items.map((it) => ({ id: it.id, ratio: ratioOf(it) })),
      box.w,
      Math.max(24, Math.min(400, Number(targetRowHeight) || 72)),
      box.gap,
    );
  }, [layout, items, box.w, box.gap, targetRowHeight]);

  // id → item 与 id → 全局下标（onOpen 的 index 是「整墙第几张」，供灯箱切换用）
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const idxById = useMemo(() => new Map(items.map((it, i) => [it.id, i])), [items]);

  const style = useMemo(
    () => ({ "--wb-gallery-gap": `${box.gap}px` }) as CSSProperties,
    [box.gap],
  );

  // ── 随机模式：整卡一张图 ──
  if (layout === "random") {
    const it = items[randIdx];
    return (
      <div className="wb-gallery wb-gallery--random">
        {it &&
          (it.src ? (
            // key 变化触发淡入（交叉淡入观感），reduced-motion 由全局 CSS 兜底
            // A11Y-1：img 包真 <button>（原裸 img onClick 无键盘通道）
            <UnstyledButton
              key={it.id}
              className="wb-gallery__random-btn"
              aria-label="放大预览"
              title={it.title}
              onClick={() => onOpen(it, randIdx)}
            >
              <img className="wb-gallery__random-img" src={it.src} alt="" />
            </UnstyledButton>
          ) : (
            <button
              type="button"
              className="wb-gallery__cell wb-gallery__cell--empty"
              title={it.title}
              onClick={() => onOpen(it, randIdx)}
            >
              <span className="wb-gallery__placeholder">
                {it.placeholder.icon}
                <span className="wb-sr-only">{it.placeholder.label}</span>
              </span>
            </button>
          ))}
      </div>
    );
  }

  // ── 铺开模式（D62：全局等高行，行尾允许留白）──
  return (
    <div className="wb-gallery" style={style} ref={hostRef}>
      {rows.map((row, ri) => (
        <div key={ri} className="wb-gallery__row" style={{ height: `${row.height}px` }}>
          {row.cells.map((cell) => {
            const it = byId.get(cell.id);
            if (!it) return null;
            return (
              <button
                key={cell.id}
                type="button"
                className={[
                  "wb-gallery__cell",
                  it.src ? "" : "wb-gallery__cell--empty",
                  hasKnownRatio(it) ? "" : "wb-gallery__cell--fallback",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ width: `${cell.width}px`, height: `${cell.height}px` }}
                title={it.title}
                onClick={() => onOpen(it, idxById.get(cell.id) ?? 0)}
              >
                {it.src ? (
                  <img src={it.src} alt="" loading="lazy" />
                ) : (
                  <span className="wb-gallery__placeholder">
                    {it.placeholder.icon}
                    <span className="wb-sr-only">{it.placeholder.label}</span>
                  </span>
                )}
                {it.badge}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
