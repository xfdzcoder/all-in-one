/**
 * 动作契约（FR-I5：组件内执行操作；FR-W1 能力声明 data/refresh/action）。
 * 动作统一走服务端 `POST /api/plugins/:id/actions`（action 名在 body；审计/权限/限流可集中做，K4）。
 */

export interface ActionCapability {
  /** 动作名（如 "todo.toggle"、"todo.create"），manifest 能力声明。 */
  name: string;
  label: string;
  /** 动作入参的字段声明（与 configSchema 同格式，宿主可生成确认表单）。 */
  params?: import("./config.ts").ConfigSchema;
}

/** 组件调用宿主动作通道的函数签名。 */
export type ActionDispatcher = (
  action: string,
  params: Record<string, unknown>,
) => Promise<void>;
