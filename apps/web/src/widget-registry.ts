import type { WidgetManifest } from "@all-in-one/widget-sdk";

import { Placeholder, StatBox } from "./widgets";
import { TodoWidget } from "./todo-widget";
import { CustomApiWidget } from "./custom-api-widget";
import { ChartWidget } from "./chart-widget";
import { RssWidget } from "./rss-widget";
import { LauncherWidget } from "./launcher-widget";
import { IframeWidget } from "./iframe-widget";
import { KanbanWidget } from "./kanban-widget";
import { MailWidget } from "./mail-widget";
import { OpencodeWidget } from "./opencode-widget";
import { TERMS } from "./terms";
import { MonitorWidget } from "./monitor-widget";
import { ServiceOverviewWidget } from "./service-overview-widget";
import { ImmichGalleryWidget } from "./immich-gallery-widget";
import { NavidromeLibraryWidget } from "./navidrome-library-widget";
import { PortainerContainersWidget } from "./portainer-containers-widget";
import { MihomoNodesWidget } from "./mihomo-nodes-widget";

/**
 * 内置组件清单 —— 全部按 widget-sdk 契约声明（J8：内置组件即规范样例）。
 * M2-⑤ 追加 custom-api；M2 后此注册表逐步被 widget-sdk 动态注册替代。
 */

const todoManifest: WidgetManifest = {
  type: "todo",
  uniqueField: "name",
  name: "个人 Todo",
  description: "Workspace 级任务清单，多页面共享同一数据",
  icon: "checklist",
  category: "数据",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 2 },
  configSchema: [
    {
      key: "name",
      label: "名称",
      type: "select",
      dynamic: "todo-names",
      creatable: true,
      required: true,
      placeholder: "选择已有或输入新名称",
      help: "任务分组名（D63）：选已有分组或输入新名创建（分组名在数据层唯一，已存在则复用）。同一分组可在任意页面放任意多个卡片，共享同一份数据",
    },
    {
      key: "filter",
      label: "显示",
      type: "select",
      default: "open",
      help: "按完成状态筛选（归档项不在组件显示）",
      options: [
        { value: "open", label: "未完成" },
        { value: "done", label: "已完成" },
        { value: "all", label: "全部" },
      ],
    },
  ],
  capabilities: {
    data: { source: "workspace", resource: "todo" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

const placeholderManifest: WidgetManifest = {
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

const statBoxManifest: WidgetManifest = {
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
const customApiManifest: WidgetManifest = {
  type: "custom-api",
  name: "自定义 API",
  description: "服务端代取任意 HTTP 接口并按模板展示（SSRF 基线防护）",
  icon: "api",
  category: "数据",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  configSchema: [
    { key: "sourceId", label: "认证来源", type: "select", dynamic: "data-source:http", help: "HTTP 连接提供认证头/令牌与站点地址（D42/D65）；留空 = 使用下方内联配置；选中后「接口地址」可填相对路径" },
    { key: "url", label: "接口地址", type: "text", required: true, placeholder: "/api/stats", help: "相对路径（以 / 开头）按「认证来源」的站点地址拼接（D65）；未选认证来源时填完整 https:// 地址" },
    { key: "method", label: "方法", type: "select", default: "GET", options: [
      { value: "GET", label: "GET" },
      { value: "POST", label: "POST" },
    ] },
    { key: "display", label: "展示模板", type: "select", default: "stat", options: [
      { value: "stat", label: "统计卡片" },
      { value: "list", label: "列表" },
      { value: "status", label: "状态点" },
      { value: "raw", label: "原始 JSON" },
      { value: "jsx", label: "受限 JSX（D35）" },
    ] },
    {
      key: "templateJsx",
      label: "受限 JSX 模板",
      type: "textarea",
      placeholder: "<Stack><Text>{data.title}</Text></Stack>",
      help: "白名单 Mantine 组件 + data 安全绑定（D35）；错误会显式提示",
    },
    { key: "path", label: "取值路径", type: "text", placeholder: "data.items（点路径，可空）" },
    { key: "labelField", label: "标题字段", type: "text", default: "name" },
    { key: "valueField", label: "数值字段", type: "text", default: "value" },
    { key: "statusField", label: "状态字段", type: "text", help: "状态模板：该字段真值=绿点" },
    { key: "apiToken", label: "访问令牌", type: "secret", help: "与「认证来源」的令牌**不同才需要填写**（相同留空即可）；填写只覆盖**本卡**（优先级高于来源），不修改来源配置（D65）。存入凭证库（SEC3）" },
    { key: "authHeader", label: "认证头名", type: "text", placeholder: "Authorization（可空 = Bearer）", help: "同「访问令牌」：与来源不同才需填写；填写仅作用于本卡（D65）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
    detail: true,
  },
};

const rssManifest: WidgetManifest = {
  type: "rss",
  name: TERMS.rss, // WEB-22：卡片标题 Q85 起为「RSS」，选择器名随之统一
  description: "多源 RSS/Atom 聚合，未读标记归 Workspace（跨组件同步）",
  icon: "rss", // Q38a：官方品牌图标
  category: "信息流",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 3 },
  configSchema: [
    { key: "limit", label: "条目数", type: "number", default: 10 },
    { key: "filter", label: "显示", type: "select", default: "all", options: [
      { value: "all", label: "全部" },
      { value: "unread", label: "仅未读" },
    ] },
    { key: "tagIds", label: "按标签筛选", type: "multiselect", dynamic: "tags", help: "选中 = 只显示含任一所选标签的订阅源条目；留空 = 全部（Q29c：筛选并入配置）" },
  ],
  capabilities: {
    data: { source: "workspace", resource: "rss" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
    detail: true,
  },
};

const launcherManifest: WidgetManifest = {
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
      help: '[{"name":"Portainer","url":"http://…:9000","probe":"http","icon":"🧩"}]；probe: http|tcp；icon 可选（emoji 或图片 URL）',
    },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 120, supportsManualRefresh: true },
  },
};

const iframeManifest: WidgetManifest = {
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
const kanbanManifest: WidgetManifest = {
  type: "kanban",
  name: "看板",
  description: "多项目看板：列与卡片、卡片操作（编辑/移动/归档/删除）",
  category: "数据",
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 4, h: 3 },
  configSchema: [
    { key: "boardId", label: "看板", type: "select", dynamic: "kanban-boards", help: "在「数据源管理 · 看板」创建与管理；组件只做视图" },
  ],
  capabilities: {
    data: { source: "workspace", resource: "kanban" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

/** OpenCode 组件（FR-E4/Q8）：会话列表/状态/耗时 + API 版本探测（D32）。 */
const opencodeManifest: WidgetManifest = {
  type: "opencode",
  name: "OpenCode",
  description: "opencode 会话列表 / 状态 / 耗时 + API 版本探测（实验性接口）",
  icon: "opencode", // Q38a：官方品牌图标
  category: "服务",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    // Q42（一.2）：只需选择已配置的数据连接 —— 连接信息在「数据源管理 · 数据连接」维护，不在组件表单重填
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:opencode", help: "在「数据源管理 · 数据连接」维护；旧组件的内联配置仍生效（兼容）" },
    { key: "limit", label: "会话条数", type: "number", default: 20 },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

/** 服务器监控组件（Q9/D36）：打通 Glances 等第三方监控源，只做连接与展示。 */
const monitorManifest: WidgetManifest = {
  type: "monitor",
  name: "服务器监控",
  description: "Glances 等监控源打通：CPU / 内存 / 负载 / 磁盘（只做连接与展示）",
  icon: "glances", // Q38a：官方品牌图标
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    // Q36（二.5）：只需选择已配置的监控源 —— 连接信息在「数据源管理 · 数据连接」维护，不在组件表单重填
    { key: "sourceId", label: "监控源", type: "select", dynamic: "data-source:monitor", help: "在「数据源管理 · 数据连接」维护；旧组件的内联配置仍生效（兼容）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

/** 服务概览（Q39/D46）：选一个服务连接 → 探活徽标 + 版本 + 关键计数。 */
const serviceOverviewManifest: WidgetManifest = {
  type: "service-overview",
  name: "服务概览",
  description: "第三方服务状态一览（Immich / Navidrome / Portainer / Mihomo）：可达性 + 版本 + 关键计数",
  icon: "apps",
  category: "服务",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:service", help: "在「数据源管理 · 数据连接」维护（Immich / Navidrome / Portainer / Mihomo）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 60, supportsManualRefresh: true },
    detail: true,
  },
};

/** Immich 照片墙（FR-X3 只读深度，D50）：最近照片网格，缩略图服务端代取。 */
const immichGalleryManifest: WidgetManifest = {
  type: "immich-gallery",
  name: "Immich 照片墙",
  description: "最近照片网格（只读）：缩略图服务端代取，点击开 Immich 原图页",
  icon: "immich",
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:immich", help: "在「数据源管理 · 数据连接」维护（Immich）" },
    { key: "limit", label: "显示张数", type: "number", default: 12, help: "1–120，最近上传优先；视频不展示" },
    {
      key: "albumId",
      label: "只看相册",
      type: "select",
      dynamic: "immich-albums",
      dependsOn: "sourceId",
      help: "Q72（项 6）：留空 = 全部相册；选项随上方「数据连接」变化",
    },
    {
      key: "layout",
      label: "展示模式",
      type: "select",
      default: "grid",
      options: [
        { value: "grid", label: "铺开（网格填满卡片）" },
        { value: "random", label: "随机（整卡一图，定时换）" },
      ],
      help: "Q71（项 6）：铺开 = 网格放大填满卡片；随机 = 整卡只展示一张图并定时随机刷新",
    },
    { key: "randomIntervalSec", label: "随机换图间隔（秒）", type: "number", default: 30, help: "仅「随机」模式生效，最短 3 秒" },
    { key: "rowHeight", label: "目标行高（px）", type: "number", default: 72, help: "每行高度（所有行完全一致）。缩略图保持原宽高比、宽度按各自比例不同；卡片更高只会显示更多行，不会把图片拉长。放不下的一张会换行，行尾可能留白" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
  },
};

/** Navidrome 专辑墙（FR-X3 只读深度，D50）：最近添加，封面服务端代取。Q94：已移除「正在播放」。 */
const navidromeLibraryManifest: WidgetManifest = {
  type: "navidrome-library",
  name: "Navidrome 专辑墙",
  description: "最近添加专辑网格（只读）：封面服务端代取",
  icon: "navidrome",
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:navidrome", help: "在「数据源管理 · 数据连接」维护（Navidrome）" },
    { key: "limit", label: "显示张数", type: "number", default: 12, help: "1–120，最近添加优先" },
    {
      key: "artistId",
      label: "只看艺人",
      type: "select",
      dynamic: "navidrome-artists",
      dependsOn: "sourceId",
      help: "Q72（项 6）：留空 = 全部艺人；选项随上方「数据连接」变化",
    },
    {
      key: "layout",
      label: "展示模式",
      type: "select",
      default: "grid",
      options: [
        { value: "grid", label: "铺开（网格填满卡片）" },
        { value: "random", label: "随机（整卡一图，定时换）" },
      ],
      help: "Q71（项 6）：铺开 = 网格放大填满卡片；随机 = 整卡只展示一张封面并定时随机刷新",
    },
    { key: "randomIntervalSec", label: "随机换封面间隔（秒）", type: "number", default: 30, help: "仅「随机」模式生效，最短 3 秒" },
    { key: "rowHeight", label: "目标行高（px）", type: "number", default: 72, help: "每行高度（所有行完全一致）。缩略图保持原宽高比、宽度按各自比例不同；卡片更高只会显示更多行，不会把图片拉长。放不下的一张会换行，行尾可能留白" },
  ],
  // D54：播放遥控（navidrome.play/pause/next/prev/stop）已移除 —— 本组件纯只读
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
  },
};

/** Portainer 容器清单（FR-X3 只读深度，D50）：状态/端口/镜像 + 日志尾部只读。 */
const portainerContainersManifest: WidgetManifest = {
  type: "portainer-containers",
  name: "Portainer 容器清单",
  description: "容器状态/端口/镜像清单（只读）：点行看日志尾部，无启停操作",
  icon: "portainer",
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:portainer", help: "在「数据源管理 · 数据连接」维护（Portainer）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 120, supportsManualRefresh: true },
  },
};

/** Mihomo 节点面板（FR-X3 只读深度，D50）：策略组/节点延迟/订阅源。 */
const mihomoNodesManifest: WidgetManifest = {
  type: "mihomo-nodes",
  name: "Mihomo 节点面板",
  description: "策略组 / 节点延迟 / 订阅源详情（只读）：无代理切换",
  icon: "mihomo",
  category: "服务",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "数据连接", type: "select", dynamic: "data-source:mihomo", help: "在「数据源管理 · 数据连接」维护（Mihomo / metacubexd）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 120, supportsManualRefresh: true },
  },
};

/** 邮件组件（Q7b）：多账号只读聚合，正文沙箱渲染（D30）。 */
const mailManifest: WidgetManifest = {
  type: "mail",
  name: "邮件",
  description: "多账号邮件聚合（只读）：列表 + 正文（沙箱渲染）",
  icon: "gmail", // Q38a：官方品牌图标
  category: "信息流",
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  configSchema: [
    { key: "accountIds", label: "展示的邮箱", type: "multiselect", dynamic: "mail-accounts", help: "多选邮箱账号；留空 = 全部。组合后按时间倒序（最新在前）" },
  ],
  capabilities: {
    data: { source: "workspace", resource: "mail" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
    detail: true,
  },
};

/** 自定义图表 v1（批H2 / **Q76，D47 + D57**）：配置即 spec（非预设指标）——
 *  取数路径 + X/Y 字段 + 图表形态编译成 ECharts option；HTTP 数据源复用 httpConnector（零服务端改动）。 */
const chartManifest: WidgetManifest = {
  type: "chart",
  name: "图表",
  description: "自定义图表（折线/柱状/饼图）：自己声明取数路径与 X/Y 字段，编译成 ECharts 图表",
  icon: "api",
  category: "数据",
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  configSchema: [
    { key: "sourceId", label: "认证来源", type: "select", dynamic: "data-source:http", help: "HTTP 连接提供认证头/令牌与站点地址（D42/D65）；留空 = 使用下方内联配置；选中后「接口地址」可填相对路径" },
    { key: "url", label: "接口地址", type: "text", required: true, placeholder: "/api/stats", help: "相对路径（以 / 开头）按「认证来源」的站点地址拼接（D65）；未选认证来源时填完整 https:// 地址" },
    { key: "method", label: "方法", type: "select", default: "GET", options: [
      { value: "GET", label: "GET" },
      { value: "POST", label: "POST" },
    ] },
    { key: "path", label: "取数路径", type: "text", placeholder: "data.items（点路径，指向**数组**）", help: "图表按行取数：该路径必须指向数组字段" },
    { key: "chartType", label: "图表类型", type: "select", default: "line", options: [
      { value: "line", label: "折线" },
      { value: "bar", label: "柱状" },
      { value: "pie", label: "饼图" },
    ] },
    { key: "xField", label: "X 轴字段", type: "text", default: "x", help: "分类轴（饼图 = 名称列）" },
    { key: "yFields", label: "Y 系列字段", type: "text", placeholder: "a,b（逗号分隔）", help: "数值列，可多列（饼图取第一个）" },
    { key: "unit", label: "单位", type: "text", placeholder: "GB / % / 次…" },
    { key: "wsSourceId", label: "WS 实时源", type: "select", dynamic: "data-source:ws", help: "Q78/D56：选定即实时流模式（服务端 WS → SSE 转发，滚动 120 点）；留空 = 上方 HTTP 快照" },
    { key: "stack", label: "堆叠", type: "boolean" },
    { key: "smooth", label: "平滑曲线", type: "boolean" },
    { key: "apiToken", label: "访问令牌", type: "secret", help: "与「认证来源」的令牌**不同才需要填写**（相同留空即可）；填写只覆盖**本卡**（优先级高于来源），不修改来源配置（D65）。存入凭证库（SEC3）" },
    { key: "authHeader", label: "认证头名", type: "text", placeholder: "Authorization（可空 = Bearer）", help: "同「访问令牌」：与来源不同才需填写；填写仅作用于本卡（D65）" },
  ],
  capabilities: {
    data: { source: "http-connector" },
    refresh: { minRefreshSec: 5, defaultRefreshSec: 300, supportsManualRefresh: true },
  },
};

/** gridstack components 映射（key = manifest.type）。 */
export const widgetComponents = {
  todo: TodoWidget,
  rss: RssWidget,
  kanban: KanbanWidget,
  mail: MailWidget,
  opencode: OpencodeWidget,
  monitor: MonitorWidget,
  "service-overview": ServiceOverviewWidget,
  "immich-gallery": ImmichGalleryWidget,
  "navidrome-library": NavidromeLibraryWidget,
  "portainer-containers": PortainerContainersWidget,
  "mihomo-nodes": MihomoNodesWidget,
  "app-launcher": LauncherWidget,
  iframe: IframeWidget,
  "custom-api": CustomApiWidget,
  chart: ChartWidget,
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
  mail: mailManifest,
  opencode: opencodeManifest,
  monitor: monitorManifest,
  "service-overview": serviceOverviewManifest,
  "immich-gallery": immichGalleryManifest,
  "navidrome-library": navidromeLibraryManifest,
  "portainer-containers": portainerContainersManifest,
  "mihomo-nodes": mihomoNodesManifest,
  "app-launcher": launcherManifest,
  iframe: iframeManifest,
  "custom-api": customApiManifest,
  chart: chartManifest,
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
  mailManifest,
  opencodeManifest,
  monitorManifest,
  serviceOverviewManifest,
  immichGalleryManifest,
  navidromeLibraryManifest,
  portainerContainersManifest,
  mihomoNodesManifest,
  launcherManifest,
  iframeManifest,
  customApiManifest,
  chartManifest,
  placeholderManifest,
  statBoxManifest,
];

/** Local fallback layout when a dashboard has none / corrupt JSON (FR-P4 兜底). */
export const FALLBACK_LAYOUT = [
  { id: "fb-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "fb-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
  { id: "fb-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
];

/** 清单显示名（ISS-15 修复）：manifest 选项与各处显示同源；未收录键原样回落。 */
