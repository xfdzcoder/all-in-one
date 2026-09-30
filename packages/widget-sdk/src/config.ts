/**
 * Widget 配置表单契约（FR-W2：configSchema 驱动表单生成）。
 * 声明式字段列表 —— 可序列化进 manifest，供宿主渲染配置表单，
 * 也是第三方插件（D7）跨语言可读的稳定格式。
 */

export type ConfigFieldType =
  | "text"
  /** 多行文本（如受限 JSX 模板源码；不作 JSON 校验）。 */
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "json"
  /** 敏感字段：值不入 widget 配置，仅存 Credential Store 引用（SEC3）。 */
  | "secret";

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  default?: unknown;
  /** type=select 时的选项。 */
  options?: Array<{ value: string; label: string }>;
  /**
   * 动态选项源（Q26b / D42）：宿主按 key 运行时取选项，与静态 options 二选一。
   * 约定 key："kanban-boards" | "data-source:monitor" | "data-source:opencode" | "data-source:http"。
   */
  dynamic?: string;
  placeholder?: string;
  help?: string;
}

/** Widget 配置表单声明（manifest.configSchema）。 */
export type ConfigSchema = ConfigField[];

/** 非敏感配置值。 */
export type ConfigValues = Record<string, unknown>;

/** 敏感字段的配置值 = Credential Store 中的引用 id（明文永不进配置/前端）。 */
export type SecretRef = { credentialRef: string };

export function isSecretRef(v: unknown): v is SecretRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "credentialRef" in v &&
    typeof (v as SecretRef).credentialRef === "string"
  );
}

/** 校验字段声明本身合法（供契约测试与未来插件安装器复用）。 */
export function validateConfigSchema(schema: ConfigSchema): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const f of schema) {
    if (!f.key) errors.push("field missing key");
    if (seen.has(f.key)) errors.push(`duplicate field key: ${f.key}`);
    seen.add(f.key);
    if (!f.label) errors.push(`field ${f.key}: missing label`);
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      errors.push(`field ${f.key}: select requires options`);
    }
  }
  return errors;
}
