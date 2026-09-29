import type { WidgetManifest } from "@all-in-one/widget-sdk";

import { Placeholder, StatBox } from "./widgets";
import { TodoWidget } from "./todo-widget";
import { CustomApiWidget } from "./custom-api-widget";
import { RssWidget } from "./rss-widget";
import { LauncherWidget } from "./launcher-widget";
import { IframeWidget } from "./iframe-widget";
import { KanbanWidget } from "./kanban-widget";

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

/** 自定义 API（D14 声明式模板 + configSchema 表单 FR-W2 + secret 字段 SEC3）。 */
export const customApiManifest: WidgetManifest = {
  type: "custom-api",
  name: "自定义 API",
  description: "服务端代取任意 HTTP 接口并按模板展示（SSRF 基线防护）",
  icon: "api",
  category: "数据",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  configSchema: [
    { key: "url", label: "接口地址", type: "text", required: true, placeholder: "https://api.example.com/…" },
    { key: "method", label: "方法", type: "select", default: "GET", options: [
      { value: "GET", label: "GET" },
      { value: "POST", label: "POST" },
    ] },
    { key: "display", label: "展示模板", type: "select", default: "stat", options: [
      { value: "stat", label: "统计卡片" },
      { value: "list", label: "列表" },
      { value: "status", label: "状态点" },
      { value: "raw", label: "原始 JSON" },
    ] },
    { key: "path", label: "取值路径", type: "text", placeholder: "data.items（点路径，可空）" },
    { key: "labelField", label: "标题字段", type: "text", default: "name" },
    { key: "valueField", label: "数值字段", type: "text", default: "value" },
    { key: "statusField", label: "状态字段", type: "text", help: "状态模板：该字段真值=绿点" },
    { key: "apiToken", label: "访问令牌", type: "secret", help: "存入凭证库，配置仅保存引用（SEC3）" },
    { key: "authHeader", label: "认证头名", type: "text", placeholder: "Authorization（可空 = Bearer）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 30, defaultRefreshSec: 300, supportsManualRefresh: true },
    detail: true,
  },
};

/** gridstack components 映射（key = manifest.type）。 */
export const rssManifest: WidgetManifest = {
  type: "rss",
  name: "信息流",
  description: "多源 RSS/Atom 聚合，未读标记归 Workspace（跨组件同步）",
  icon: "rss",
  category: "信息流",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 3 },
  configSchema: [
    { key: "limit", label: "条目数", type: "number", default: 10 },
    { key: "filter", label: "显示", type: "select", default: "all", options: [
      { value: "all", label: "全部" },
      { value: "unread", label: "仅未读" },
    ] },
  ],
  capabilities: {
    data: { source: "workspace", resource: "rss" },
    refresh: { minRefreshSec: 30, defaultRefreshSec: 300, supportsManualRefresh: true },
    detail: true,
  },
};

export const launcherManifest: WidgetManifest = {
  type: "app-launcher",
  name: "应用入口",
  description: "服务聚合入口，HTTP/TCP 存活探测（内网服务，D22）",
  icon: "apps",
  category: "服务",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    {
      key: "itemsJson",
      label: "服务列表 JSON",
      type: "json",
      required: true,
      help: '[{"name":"Portainer","url":"http://192.168.31.133:9000","probe":"http"}]；probe: http|tcp',
    },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 30, defaultRefreshSec: 120, supportsManualRefresh: true },
  },
};

export const iframeManifest: WidgetManifest = {
  type: "iframe",
  name: "嵌入页面",
  description: "iframe 嵌入第三方页面（sandbox 沙箱；目标站禁嵌时给出提示）",
  icon: "iframe",
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "url", label: "页面地址", type: "text", required: true, placeholder: "http://192.168.31.133:9000" },
    { key: "sandbox", label: "沙箱能力", type: "text", placeholder: "默认 allow-scripts（可加 allow-same-origin）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
  },
};

/** 看板组件（Q6b）：多项目看板，Workspace 数据（D21），配置看板经组件内选择器写回 props。 */
export const kanbanManifest: WidgetManifest = {
  type: "kanban",
  name: "看板",
  description: "多项目看板：列与卡片、卡片操作（编辑/移动/归档/删除）",
  category: "数据",
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 4, h: 3 },
  configSchema: [],
  capabilities: {
    data: { source: "workspace", resource: "kanban" },
    refresh: { minRefreshSec: 10, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

/** gridstack components 映射（key = manifest.type）。 */
export const widgetComponents = {
  todo: TodoWidget,
  rss: RssWidget,
  kanban: KanbanWidget,
  "app-launcher": LauncherWidget,
  iframe: IframeWidget,
  "custom-api": CustomApiWidget,
  // manifest.type 别名：组件选择器按 type 添加（placeholder/stat-box）；
  // 旧布局 JSON 用类名 key（Placeholder/StatBox），保留兼容（seed/历史布局）。
  placeholder: Placeholder,
  "stat-box": StatBox,
  Placeholder,
  StatBox,
};

/** 渲染 key（component 字段）→ manifest（配置表单/默认尺寸来源）。 */
const manifestsByComponent: Record<string, WidgetManifest> = {
  todo: todoManifest,
  rss: rssManifest,
  kanban: kanbanManifest,
  "app-launcher": launcherManifest,
  iframe: iframeManifest,
  "custom-api": customApiManifest,
  placeholder: placeholderManifest,
  Placeholder: placeholderManifest,
  "stat-box": statBoxManifest,
  StatBox: statBoxManifest,
};

export function manifestForComponent(component: string): WidgetManifest | undefined {
  return manifestsByComponent[component];
}

/** 内置 manifest 清单（供组件选择器 / 配置表单 / J8 验证）。 */
export const builtinManifests: WidgetManifest[] = [
  todoManifest,
  rssManifest,
  kanbanManifest,
  launcherManifest,
  iframeManifest,
  customApiManifest,
  placeholderManifest,
  statBoxManifest,
];

/** Local fallback layout when a dashboard has none / corrupt JSON (FR-P4 兜底). */
export const FALLBACK_LAYOUT = [
  { id: "fb-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "fb-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
  { id: "fb-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
];
