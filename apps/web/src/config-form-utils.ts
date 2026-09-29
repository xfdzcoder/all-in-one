import type { ConfigField, ConfigSchema, ConfigValues, SecretRef } from "@all-in-one/widget-sdk";
import { isSecretRef } from "@all-in-one/widget-sdk";

/**
 * FR-W2：configSchema → 表单值收集（Mantine 表单渲染见 ConfigForm.tsx）。
 * secret 字段由凭证选择器写入 SecretRef（SEC3）。
 */

export function defaultsFromSchema(schema: ConfigSchema): ConfigValues {
  const out: ConfigValues = {};
  for (const f of schema) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === "boolean") out[f.key] = false;
    else if (f.type === "secret") out[f.key] = undefined;
    else out[f.key] = "";
  }
  return out;
}

export type FieldError = { key: string; message: string };

/** 校验表单值（required / 类型），返回错误列表。 */
export function validateForm(schema: ConfigSchema, values: ConfigValues): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of schema) {
    const v = values[f.key];
    // secret 字段编辑期为明文字符串（提交时入库凭证库），或已是 SecretRef
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (f.type === "secret" && typeof v !== "string" && !isSecretRef(v));
    if (f.required && empty) {
      errors.push({ key: f.key, message: `${f.label} 必填` });
      continue;
    }
    if (!empty && f.type === "number" && typeof v !== "number") {
      errors.push({ key: f.key, message: `${f.label} 需为数字` });
    }
    if (!empty && f.type === "json") {
      try {
        JSON.parse(String(v));
      } catch {
        errors.push({ key: f.key, message: `${f.label} 需为合法 JSON` });
      }
    }
    if (!empty && f.type === "select") {
      const okOpt = f.options?.some((o) => o.value === v);
      if (!okOpt) errors.push({ key: f.key, message: `${f.label} 取值非法` });
    }
  }
  return errors;
}

export function fieldOf(schema: ConfigSchema, key: string): ConfigField | undefined {
  return schema.find((f) => f.key === key);
}

export function secretRefOf(v: unknown): SecretRef | null {
  return isSecretRef(v) ? (v as SecretRef) : null;
}
