import type { ConfigValues } from "./config.ts";
import type { ActionDispatcher } from "./action.ts";
import type { WidgetDataState } from "./data.ts";

/**
 * 生命周期契约（FR-W4：挂载/配置变更/刷新/卸载/错误态）。
 * 宿主（apps/web）按此 props 渲染组件；组件只消费数据、派发动作。
 */

export interface WidgetProps<TConfig = ConfigValues, TData = unknown> {
  /** widget 实例 id（Dashboard 布局中的唯一 id）。 */
  widgetId: string;
  /** 已解析配置（secret 字段仅为引用，不含明文）。 */
  config: TConfig;
  /** 宿主统一数据通道喂入的数据状态。 */
  data: WidgetDataState<TData>;
  /** 触发一次手动刷新（FR-I3）。 */
  refresh: () => void;
  /** 执行动作（FR-I5）。 */
  dispatch: ActionDispatcher;
  /** 组件可写内部视图状态（如选中 tab）由组件自理。 */
}

/** 组件实现形态：函数组件即可（M2 起内置组件也按此实现，J8）。 */
export type WidgetComponent<P extends WidgetProps = WidgetProps> = (
  props: P,
) => unknown;
