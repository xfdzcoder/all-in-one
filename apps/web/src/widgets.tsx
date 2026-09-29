export function Placeholder({ title, color }: Record<string, unknown>) {
  return (
    // 文字纯白：底色可由用户配置（如 #4a6fa5/#4a7d6b），白字对深/中性底色均 ≥4.5:1（AA）
    <div className="ph" style={{ background: String(color ?? "#4a6fa5"), color: "#fff" }}>
      <strong>{String(title ?? "widget")}</strong>
    </div>
  );
}

export function StatBox({ label, value }: Record<string, unknown>) {
  return (
    <div className="stat">
      <div className="stat-label">{String(label ?? "")}</div>
      <div className="stat-value">{String(value ?? "")}</div>
    </div>
  );
}
