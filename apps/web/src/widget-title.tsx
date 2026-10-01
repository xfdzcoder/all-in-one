import { Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * 卡片标题区（Q86 / 项 13，**D59**）。
 *
 * 结构 = logo + 标题文本（左）+ 动作簇（右）—— 与各组件原本手写的
 * `<Group gap={6}>…` 完全同构，因此换用本组件**不产生视觉变化**。
 *
 * **只有标题区可点**（logo+文本），整卡**不可点**：卡片内部已有大量交互
 * （行点击、按钮、复选框），整卡链接会与之冲突并造成误触。
 *
 * `href` 缺省时只渲染文本（Mihomo 纯 API、信息流、ToDo、看板等无站点）。
 * 样式走 `.wb-widget__head` / `.wb-widget__title-link` 语义类（D39：类名即公共 API）。
 */
export function WidgetTitle({
  icon,
  title,
  href,
  actions,
}: {
  /** 左侧 logo（通常 `<ServiceIcon …/>`）。 */
  icon?: ReactNode;
  title: ReactNode;
  /** 可跳转站点；缺省 = 纯文本标题（不渲染成链接）。 */
  href?: string;
  /** 右侧动作簇（刷新/配置等 icon 按钮）。传了才渲染整行头部，否则只渲染左段。 */
  actions?: ReactNode;
}) {
  const inner = (
    <>
      {icon}
      <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
        {title}
      </Text>
    </>
  );

  const head = href ? (
    <a className="wb-widget__title-link" href={href} target="_blank" rel="noopener noreferrer" title={href}>
      {inner}
    </a>
  ) : (
    <span className="wb-widget__title-link wb-widget__title-link--plain">{inner}</span>
  );

  // 不传 actions = 只渲染左段（可作为现有 `<Group>` 头部行里的直接子元素，flex:1 占满剩余宽度）
  if (!actions) return head;

  return (
    <Group gap={6} className="wb-widget__head">
      {head}
      <Group gap={6} wrap="nowrap" className="wb-widget__actions">
        {actions}
      </Group>
    </Group>
  );
}
