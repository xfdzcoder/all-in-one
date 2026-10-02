import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

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

  // ── WEB-15：对话框焦点管理（打开聚焦 → Tab 圈闭 → 关闭还焦 → 背景 inert）──
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // 打开：记住焦点源并把焦点移进对话框（读屏/键盘用户不再停留在被遮罩的底层）
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    // 背景 inert：遮罩经 portal 挂 body，#root 整棵置 inert（含 aria-hidden 双保险）
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    return () => {
      root?.removeAttribute("inert");
      root?.removeAttribute("aria-hidden");
      // 关闭：焦点还给打开它的元素
      const prev = restoreFocusRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);
  useEffect(() => {
    // Tab 圈闭：焦点只在对话框内循环（顺序：‹ › 链接/按钮）
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const focusables = [...el.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')];
      if (focusables.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, []);

  return createPortal(
    // A11Y-1 豁免留因：① `role="dialog"` 保留 div —— native <dialog> 的 top-layer 会破
    // 全屏遮罩的 fixed 定位/淡入动画，ARIA `div role=dialog` 是标准做法；② 遮罩点击关闭
    // 不给键盘事件 —— 键盘通道已有（Esc 关闭 / ←→ 切换，window keydown），把遮罩做成
    // tabbable 反而劣化键盘流。
    // WEB-15：portal 挂 body + 焦点管理（见上）—— 遮罩与 #root 兄弟级，背景才能真正 inert。
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- 见上：键盘通道在 window keydown（Esc/←→）
    <div
      ref={dialogRef}
      tabIndex={-1}
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
    </div>,
    document.body,
  );
}
