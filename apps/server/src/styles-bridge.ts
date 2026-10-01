/**
 * Mantine 变量 → --wb-* 令牌桥（Q19b · **D54 批A2 全局去灰**）。
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

/* ── 全局去灰（D54 批A2）──────────────────────────────────────────
 * 根因：Mantine 用中性灰阶做组件底色 —— 深色下 Card / Input / Checkbox /
 * Menu / Popover / Table / Progress / Tabs / Switch / Slider / Skeleton /
 * Pagination / Chip / Code / ScrollArea / SegmentedControl / Timeline 等
 * 40+ 处引用 --mantine-color-dark-6（实测 #2e2e2e）与 dark-4/5/7/8；
 * Badge color="gray"、ActionIcon color="gray"、Paper 边框等另走 gray 色阶。
 * 与我们的 tinted slate 主题不搭 —— 整阶重映射到 --wb-* 令牌（中间档用
 * color-mix 推导，不引入裸色值），一处收口即全站生效，且仍可被 custom.css 覆盖。
 *
 * 语义对应：-6 = raised 面 · -7 = surface 面 · -8/-9 = 底 · -4 = 边框/轨道 ·
 * -5 = hover 面 · -0..-3 = 文本/禁用档。
 *
 * **必须分 scheme**：dark 色阶在浅色下另有用途（如「视频」徽标 color="dark"
 * 的 filled 底），全局覆盖会反噬浅色对比度。 */

/* 深色主题：dark-* 与 gray-* 都是组件表面，统一染 slate 深色分层 */
:root[data-mantine-color-scheme='dark'] {
  --mantine-color-dark-0: var(--wb-color-text);
  --mantine-color-dark-1: var(--wb-color-text-secondary);
  --mantine-color-dark-2: var(--wb-color-text-muted);
  --mantine-color-dark-3: color-mix(in srgb, var(--wb-color-surface-raised) 72%, var(--wb-color-text-muted));
  --mantine-color-dark-4: color-mix(in srgb, var(--wb-color-border-strong) 85%, var(--wb-color-surface-raised));
  --mantine-color-dark-5: var(--wb-color-surface-hover);
  --mantine-color-dark-6: var(--wb-color-surface-raised);
  --mantine-color-dark-7: var(--wb-color-surface);
  --mantine-color-dark-8: color-mix(in srgb, var(--wb-color-bg) 60%, var(--wb-color-surface));
  --mantine-color-dark-9: var(--wb-color-bg);

  --mantine-color-gray-0: var(--wb-color-text);
  --mantine-color-gray-1: var(--wb-color-text-secondary);
  --mantine-color-gray-2: var(--wb-color-text-muted);
  --mantine-color-gray-3: color-mix(in srgb, var(--wb-color-surface-raised) 62%, var(--wb-color-text-muted));
  --mantine-color-gray-4: color-mix(in srgb, var(--wb-color-border-strong) 85%, var(--wb-color-surface-raised));
  --mantine-color-gray-5: var(--wb-color-surface-hover);
  --mantine-color-gray-6: var(--wb-color-surface-raised);
  --mantine-color-gray-7: var(--wb-color-surface);
  --mantine-color-gray-8: color-mix(in srgb, var(--wb-color-bg) 60%, var(--wb-color-surface));
  --mantine-color-gray-9: var(--wb-color-bg);
}

/* 浅色主题：只染 gray-*（dark-* 保留 Mantine 语义，供 color="dark" 徽标等使用） */
:root[data-mantine-color-scheme='light'] {
  --mantine-color-gray-0: var(--wb-color-surface-raised);
  --mantine-color-gray-1: color-mix(in srgb, var(--wb-color-surface-raised) 55%, var(--wb-color-bg));
  --mantine-color-gray-2: var(--wb-color-bg);
  --mantine-color-gray-3: color-mix(in srgb, var(--wb-color-bg) 62%, var(--wb-color-border-strong));
  --mantine-color-gray-4: color-mix(in srgb, var(--wb-color-border-strong) 55%, var(--wb-color-text-muted));
  --mantine-color-gray-5: var(--wb-color-text-muted);
  --mantine-color-gray-6: var(--wb-color-text-secondary);
  --mantine-color-gray-7: color-mix(in srgb, var(--wb-color-text-secondary) 55%, var(--wb-color-text));
  --mantine-color-gray-8: var(--wb-color-text);
  --mantine-color-gray-9: color-mix(in srgb, var(--wb-color-text) 82%, #000);
}
`;
