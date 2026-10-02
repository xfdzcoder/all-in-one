import type { ReactNode } from "react";
import { ActionIcon, Button, Text, Tooltip } from "@mantine/core";
import { forwardRef } from "react";

/** 图标动作按钮（Q65/D52「文字按钮尽量 icon 化」）：图标 + tooltip + aria-label + sr-only 文本。
 *  sr-only 保留可访问名与 verify 文本匹配兼容（视觉上只剩图标）——
 *  因此 `label` 必须与原文字按钮一致，verify-* 脚本的 textContent 选择器可零迁移。
 *  Q118：改 forwardRef —— 可直接当 Mantine `Popover.Target`（需要 ref 转发）。 */

export const IconAction = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    tooltip?: string;
    onClick?: () => void;
    /** 外链：渲染成 `<a>`（新标签 + noopener），如「在 Immich 中打开」。 */
    href?: string;
    danger?: boolean;
    disabled?: boolean;
    /** 顶部工具栏等处用 "default" 保持与原文字按钮同观感；默认 "subtle"（卡片内动作簇）。 */
    variant?: "subtle" | "default" | "light" | "outline" | "filled" | "transparent";
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    children: ReactNode;
  }
>(function IconAction(
  {
    label,
    tooltip,
    onClick,
    href,
    danger,
    disabled,
    variant = "subtle",
    size = "sm",
    children,
  },
  ref,
) {
  return (
    <Tooltip label={tooltip ?? label} withinPortal>
      <ActionIcon
        ref={ref}
        {...(href
          ? ({ component: "a", href, target: "_blank", rel: "noopener noreferrer" } as object)
          : {})}
        variant={variant}
        color={danger ? "red" : "gray"}
        size={size}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
        <span className="wb-sr-only">{label}</span>
      </ActionIcon>
    </Tooltip>
  );
});

/** 骨架屏（D52 批3）：替换"加载中…"文本 —— shimmer 占位条（宽度档位在 CSS 中按序定义）。 */
export function WbLoading({ rows = 3 }: { rows?: number }) {
  return (
    <output className="wb-skeleton" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="wb-skeleton__bar" />
      ))}
    </output>
  );
}

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

/** 相对时间（P1-4）："刚刚 / n 分钟前 / n 小时前 / n 天前 / 日期"；悬浮显示绝对时间。 */
export function formatRelative(value: string | number | Date): string {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(t).toISOString().slice(0, 10);
}

export function RelativeTime({ value, prefix }: { value: string | number | Date; prefix?: string }) {
  // WEB-9：非法时间（空串/脏数据）此前在 render 期 `toISOString()` 抛 RangeError → 整卡崩
  // （formatRelative 早有防护，这里补同口径：非法回退「—」）
  const t = new Date(value).getTime();
  const abs = Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "";
  return (
    <span title={abs || undefined}>
      {prefix}
      {formatRelative(value) || "—"}
    </span>
  );
}

/** 服务类组件空态引导（**WEB-12 收口**）：提示文案 + 可选「去添加」跳转。
 *  跳转走 `wb:navigate`（Q36 既有范式：组件不直接引路由，头部监听该事件切视图）；
 *  DOM 与此前各组件手写的 `.wb-widget__hint` 块完全同构。 */
export function SourceHint({ text, actionLabel }: { text: string; actionLabel?: string }) {
  return (
    <div className="wb-widget__hint">
      <Text size="xs" c="dimmed">
        {text}
      </Text>
      {actionLabel && (
        <Button
          size="compact-xs"
          variant="default"
          onClick={() => window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "sources" } }))}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
