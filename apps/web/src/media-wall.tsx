import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * 媒体墙（Q71，Immich 照片墙 / Navidrome 专辑墙共用）。
 *
 * 项 6 三条要求：
 *  1. **填满卡片**：列/行都用 `minmax(<最小值>, 1fr)` —— 有空间就**无上限放大**填满，
 *     低于最小值**不压缩**，放不下就滚动（不设最大尺寸）。
 *  2. **两种模式**：`grid` 铺开 / `random` 随机 —— 随机模式整卡只展示一张图，
 *     按 `randomIntervalSec` 定时随机换一张（交叉淡入）。
 *  3. 缩略图不可用时渲染占位块（Q70），不丢格子。
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
}

export function MediaWall({
  items,
  layout = "grid",
  randomIntervalSec = 30,
  minCell = 72,
  onOpen,
}: {
  items: MediaWallItem[];
  /** `grid` 铺开（默认）/ `random` 随机单图。 */
  layout?: "grid" | "random";
  /** 随机模式的换图间隔（秒）。 */
  randomIntervalSec?: number;
  /** 格子最小边长（px）—— 只限最小、不限最大。 */
  minCell?: number;
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

  const style = useMemo(
    () => ({ "--wb-gallery-min": `${Math.max(24, Math.min(400, Number(minCell) || 72))}px` }) as CSSProperties,
    [minCell],
  );

  // ── 随机模式：整卡一张图 ──
  if (layout === "random") {
    const it = items[randIdx];
    return (
      <div className="wb-gallery wb-gallery--random" style={style}>
        {it &&
          (it.src ? (
            // key 变化触发淡入（交叉淡入观感），reduced-motion 由全局 CSS 兜底
            <img
              key={it.id}
              className="wb-gallery__random-img"
              src={it.src}
              alt=""
              title={it.title}
              onClick={() => onOpen(it, randIdx)}
            />
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

  // ── 铺开模式 ──
  return (
    <div className="wb-gallery" style={style}>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          className={`wb-gallery__cell${it.src ? "" : " wb-gallery__cell--empty"}`}
          title={it.title}
          onClick={() => onOpen(it, i)}
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
      ))}
    </div>
  );
}
