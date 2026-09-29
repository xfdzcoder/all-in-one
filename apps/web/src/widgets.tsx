export function Placeholder({ title, color }: Record<string, unknown>) {
  return (
    <div className="ph" style={{ background: String(color ?? "#4a6fa5") }}>
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
