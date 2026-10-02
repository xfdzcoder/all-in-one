/**
 * 数据通道契约（FR-W3：声明数据源 → 服务端代取 → 缓存/刷新）。
 * Widget 组件自身永不直连第三方 —— 凭证与出站请求都在服务端 connector。
 */

/** 数据来源种类（能力声明用）。 */
export type DataSourceKind =
  /** Workspace 内部业务数据（如 Todo）—— 走工作台自身 API。 */
  | "workspace"
  /** 服务端 HTTP connector 代取（自定义 API、RSS 等）—— 拒内网目标（SEC4）。 */
  | "http-connector"
  /** 无数据源（纯展示，如 iframe）。 */
  | "none";

export interface DataCapability {
  source: DataSourceKind;
  /** source=workspace 时的资源名（如 "todo"）。 */
  resource?: string;
}

/** 宿主喂给组件的统一数据状态（生命周期：loading / data / error）。 */
export interface WidgetDataState<T = unknown> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  /** 服务端数据的抓取时间（展示"x 分钟前"）。 */
  fetchedAt?: string;
}

/** 刷新能力声明（FR-I3：定时刷新 / 手动刷新）。 */
export interface RefreshCapability {
  /** 允许的最小刷新间隔（秒），防打爆第三方 API（NFR4）。 */
  minRefreshSec: number;
  defaultRefreshSec: number;
  supportsManualRefresh?: boolean;
}

/** 数据查询结果（服务端数据通道 → 前端）。
 *  CON-7：三方对齐 —— 服务端一直回 `{data, fetchedAt, cached}`，契约此前漏了 `cached`。 */
export interface WidgetDataResponse<T = unknown> {
  data: T;
  /** 服务端**抓取**时间（ISO）；缓存命中 = 该缓存的抓取时间，不是本次请求时间。 */
  fetchedAt: string;
  /** true = 服务端缓存命中（未回源）。 */
  cached?: boolean;
}
