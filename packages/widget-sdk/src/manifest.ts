import type { ConfigSchema } from "./config.ts";
import { validateConfigSchema } from "./config.ts";
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
   * 数据实体引用声明（**D63**，修订 D43）：该字段的值**引用一个数据实体**（如 todo 的
   * "name" 指向一个任务分组）。
   *
   * ⚠️ **唯一性是「数据实体」维度的，不是「展示位置」维度的**：数据实体名在数据层唯一
   * （如 todo 分组名在分组表内唯一，已存在则复用），但**同一份数据可以在任意页面展示任意
   * 多次**。宿主**不做**「同 type 组件不得重名」的拒绝 —— D43 早期实现把两者混为一谈，
   * 导致「在多个页面放同一个 ToDo」被挡。
   *
   * 本字段现为**语义声明**（告诉插件作者这个值指向数据实体），不触发任何拒绝。
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

/** 契约校验：供单元测试与未来插件安装器（FR-W6）复用。
 *  SDK-2：入参收 `unknown` —— 校验对象本来就是不可信 JSON，调用方此前被迫
 *  `validateManifest(parsed as WidgetManifest)` 断言（断言逃逸面外移）。 */
export function validateManifest(input: unknown): string[] {
  // SDK-1：`JSON.parse("null")` 是合法 JSON —— 入参 null/非对象时 `m.type` 直接 TypeError
  // （插件安装 manifest.json 为 null → 未捕获异常 → 500 而非 400）
  if (!input || typeof input !== "object") return ["manifest must be an object"];
  const m = input as WidgetManifest; // 唯一断言点：校验器边界（后续逐字段校验产出 errors）
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
  // SDK-3：configSchema 是接口必填 —— 缺/坏表单声明的 manifest 不得过安装校验
  //（此前不校验 → 宿主表单渲染无依据，与 README「安装/加载前校验」口径不符）
  if (!Array.isArray(m.configSchema)) errors.push(`${m.type}: configSchema must be an array`);
  else errors.push(...validateConfigSchema(m.configSchema).map((e) => `${m.type}: ${e}`));
  return errors;
}
