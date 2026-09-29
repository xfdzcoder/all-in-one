import type { WidgetManifest } from "@all-in-one/widget-sdk";

import { Placeholder, StatBox } from "./widgets";
import { TodoWidget } from "./todo-widget";

/**
 * 内置组件清单 —— 全部按 widget-sdk 契约声明（J8：内置组件即规范样例）。
 * M2-⑤ 追加 custom-api；M2 后此注册表逐步被 widget-sdk 动态注册替代。
 */

export const todoManifest: WidgetManifest = {
  type: "todo",
  name: "个人 Todo",
  description: "Workspace 级任务清单，多页面共享同一数据",
  icon: "checklist",
  category: "数据",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 2 },
  configSchema: [
    {
      key: "list",
      label: "清单",
      type: "select",
      default: "inbox",
      options: [
        { value: "inbox", label: "收件箱" },
        { value: "work", label: "工作" },
        { value: "life", label: "生活" },
      ],
    },
    {
      key: "filter",
      label: "显示",
      type: "select",
      default: "open",
      options: [
        { value: "open", label: "未完成" },
        { value: "all", label: "全部" },
      ],
    },
  ],
  capabilities: {
    data: { source: "workspace", resource: "todo" },
    refresh: { minRefreshSec: 10, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

export const placeholderManifest: WidgetManifest = {
  type: "placeholder",
  name: "占位组件",
  category: "其它",
  defaultSize: { w: 4, h: 3 },
  configSchema: [
    { key: "title", label: "标题", type: "text", default: "欢迎" },
    { key: "color", label: "颜色", type: "text", default: "#4a6fa5" },
  ],
  capabilities: { data: { source: "none" } },
};

export const statBoxManifest: WidgetManifest = {
  type: "stat-box",
  name: "指标卡片",
  category: "其它",
  defaultSize: { w: 4, h: 2 },
  configSchema: [
    { key: "label", label: "标签", type: "text" },
    { key: "value", label: "数值", type: "text" },
  ],
  capabilities: { data: { source: "none" } },
};

/** gridstack components 映射（key = manifest.type）。 */
export const widgetComponents = {
  todo: TodoWidget,
  Placeholder,
  StatBox,
};

/** 内置 manifest 清单（供组件选择器 / 配置表单 / J8 验证）。 */
export const builtinManifests: WidgetManifest[] = [
  todoManifest,
  placeholderManifest,
  statBoxManifest,
];

/** Local fallback layout when a dashboard has none / corrupt JSON (FR-P4 兜底). */
export const FALLBACK_LAYOUT = [
  { id: "fb-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "fb-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
  { id: "fb-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
];
