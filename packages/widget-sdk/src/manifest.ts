import type { ConfigSchema } from "./config.ts";
import type { DataCapability, RefreshCapability } from "./data.ts";
import type { ActionCapability } from "./action.ts";

/**
 * Widget Manifest 契约（FR-W1）—— Widget 的唯一身份与能力声明。
 * 内置组件与未来第三方插件（D7）共用此格式；宿主据此渲染选择器、
 * 配置表单（FR-W2）、调度数据通道（FR-W3）。
 */

export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetManifest {
  /**
   * 唯一字段声明（D43）：该字段的值在同一 type 的所有实例间全站唯一，
   * 宿主在配置保存/添加时校验（重名拒绝）。如 todo 的 "name"。
   */
  uniqueField?: string;
  /** 全局唯一 id（如 "todo"、"custom-api"、"iframe"）。 */
  type: string;
  name: string;
  description?: string;
  /** 图标标识（内置图标名或 URL）。 */
  icon?: string;
  /** 分类（如 "数据"、"服务"、"信息流"）。 */
  category?: string;
  /** 默认尺寸（gridstack 格子单位）。 */
  defaultSize: WidgetSize;
  /** 最小尺寸（gridstack minW/minH）。 */
  minSize?: WidgetSize;
  /** 配置表单声明（FR-W2）。 */
  configSchema: ConfigSchema;
  /** 能力声明（FR-W1：data/refresh/action/detail）。 */
  capabilities: {
    data: DataCapability;
    refresh?: RefreshCapability;
    actions?: ActionCapability[];
    /** 支持工作台内查看详情（FR-I4）。 */
    detail?: boolean;
  };
}

/** 契约校验：供单元测试与未来插件安装器（FR-W6）复用。 */
export function validateManifest(m: WidgetManifest): string[] {
  const errors: string[] = [];
  if (!m.type) errors.push("missing type");
  if (!m.name) errors.push(`${m.type}: missing name`);
  if (!m.defaultSize?.w || !m.defaultSize?.h) {
    errors.push(`${m.type}: defaultSize must have positive w/h`);
  }
  if (m.minSize && m.defaultSize) {
    if (m.minSize.w > m.defaultSize.w || m.minSize.h > m.defaultSize.h) {
      errors.push(`${m.type}: minSize larger than defaultSize`);
    }
  }
  if (!m.capabilities?.data) errors.push(`${m.type}: missing data capability`);
  return errors;
}
