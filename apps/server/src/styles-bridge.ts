/**
 * Mantine 变量 → --wb-* 令牌桥（Q19b）。
 *
 * 为什么不放在前端打包 CSS：Mantine 在运行时把自身默认值与 resolver 输出并入同一规则
 * （默认值在后 = 覆盖我们的值）。本桥接与用户自定义一起经 /custom.css 于文档末尾下发：
 * - 层叠顺序最晚 → 必然胜过打包 CSS 与 Mantine 注入的同名变量；
 * - 用户段落（./data/custom.css）永远拼接在桥接段落之后 → 后写覆盖前写，全程无需 !important。
 *
 * 令牌定义见 apps/web/src/styles/tokens.css；覆盖指南见 docs/design-audit/02-custom-css.md。
 */
export const MANTINE_BRIDGE_CSS = `/* ── Mantine 令牌桥（Q19b）：改 --wb-* 令牌即全局生效 ── */
:root[data-mantine-color-scheme] {
  --mantine-color-body: var(--wb-color-bg);
  --mantine-color-text: var(--wb-color-text);
  --mantine-color-dimmed: var(--wb-color-text-muted);
  --mantine-color-placeholder: var(--wb-color-text-muted);
  --mantine-color-default: var(--wb-color-surface);
  --mantine-color-default-hover: var(--wb-color-surface-hover);
  --mantine-color-default-border: var(--wb-color-border-strong);
  --mantine-primary-color-filled: var(--wb-color-accent);
  --mantine-primary-color-filled-hover: var(--wb-color-accent-hover);
}
`;
