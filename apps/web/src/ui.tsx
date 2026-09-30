import type { ReactNode } from "react";

/**
 * 统一提示条（Q19c / P1-3）：错误红、警告黄、信息青、成功绿。
 * 图标 + 色 + 文案 + 可关三件套；样式全部走 `.wb-alert*` 语义类（可被 /custom.css 覆盖）。
 */
const ICONS: Record<"error" | "warning" | "info" | "success", ReactNode> = {
  error: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4.2M8 11.2v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.2 14.4 13.2H1.6L8 2.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.4v3M8 11.4v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.2v4M8 4.6v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4.8 8.2 2.2 2.2 4.2-4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export function WbAlert({
  tone,
  children,
  onClose,
  size = "md",
}: {
  tone: "error" | "warning" | "info" | "success";
  children: ReactNode;
  onClose?: () => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`wb-alert wb-alert--${tone}${size === "sm" ? " wb-alert--sm" : ""}`} role={tone === "error" ? "alert" : undefined}>
      <span className="wb-alert__icon">{ICONS[tone]}</span>
      <div className="wb-alert__text">{children}</div>
      {onClose && (
        <button type="button" className="wb-alert__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );
}
