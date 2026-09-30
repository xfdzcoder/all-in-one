import type { CSSProperties } from "react";

export function Placeholder({ title, color }: Record<string, unknown>) {
  return (
    // 底色是实例配置（数据），经 CSS 变量绑入 —— 仍可被 /custom.css 的 --wb-placeholder-bg 覆盖
    <div className="wb-placeholder" style={{ "--wb-placeholder-bg": String(color ?? "#4a6fa5") } as CSSProperties}>
      <strong className="wb-placeholder__title">{String(title ?? "widget")}</strong>
    </div>
  );
}

export function StatBox({ label, value }: Record<string, unknown>) {
  return (
    <div className="wb-metric">
      <div className="wb-metric__label">{String(label ?? "")}</div>
      <div className="wb-metric__value">{String(value ?? "")}</div>
    </div>
  );
}
