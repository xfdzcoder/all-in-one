import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * 媒体预览遮罩层（Q73 / 项 8、项 9）。
 *
 * 项 9：**无边框遮罩层替代弹窗** —— 不用 Mantine Modal（它带边框/圆角/阴影），
 * 改为全屏半透明遮罩 + 居中大图，观感接近系统相册；点外部 / Esc 关闭。
 * 项 8：**左右切换**（‹ › 圆形图标钮，悬浮显现 + `←`/`→` 键盘 + 循环）。
 *
 * 样式全走 `.wb-lightbox*` 语义类（D39：类名即公共 API，可被 /custom.css 覆盖）。
 */
export function MediaLightbox({
  src,
  title,
  meta,
  footer,
  onPrev,
  onNext,
  onClose,
  children,
}: {
  /** 图片 data URI；空 = 渲染 children（占位说明）。 */
  src?: string;
  title?: string;
  meta?: ReactNode;
  /** 右下角动作区（如「在 Immich 中打开」）。 */
  footer?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** src 为空时的占位内容。 */
  children?: ReactNode;
}) {
  const hasNav = Boolean(onPrev && onNext);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (hasNav && e.key === "ArrowLeft") onPrev?.();
      else if (hasNav && e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNav, onPrev, onNext, onClose]);

  return (
    // A11Y-1 豁免留因：① `role="dialog"` 保留 div —— native <dialog> 的 top-layer 会破
    // 全屏遮罩的 fixed 定位/淡入动画，ARIA `div role=dialog` 是标准做法；② 遮罩点击关闭
    // 不给键盘事件 —— 键盘通道已有（Esc 关闭 / ←→ 切换，window keydown），把遮罩做成
    // tabbable 反而劣化键盘流。
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- 见上：键盘通道在 window keydown（Esc/←→）
    <div
      className="wb-lightbox"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- 见上：native <dialog> top-layer 破全屏遮罩，ARIA div role=dialog 是标准做法
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "预览"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {hasNav && (
        <button type="button" className="wb-lightbox__nav wb-lightbox__nav--prev" aria-label="上一张" onClick={onPrev}>
          ‹
        </button>
      )}
      <figure className="wb-lightbox__stage">
        {src ? <img className="wb-lightbox__img" src={src} alt="" /> : children}
        {(title || meta || footer) && (
          <figcaption className="wb-lightbox__bar">
            {title && <span className="wb-lightbox__title">{title}</span>}
            <span className="wb-lightbox__meta">{meta}</span>
            <span className="wb-lightbox__actions">{footer}</span>
          </figcaption>
        )}
      </figure>
      {hasNav && (
        <button type="button" className="wb-lightbox__nav wb-lightbox__nav--next" aria-label="下一张" onClick={onNext}>
          ›
        </button>
      )}
      <button type="button" className="wb-lightbox__close" aria-label="关闭" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
