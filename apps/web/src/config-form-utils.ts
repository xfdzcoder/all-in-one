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
    if (!empty && f.type === "select" && !f.dynamic) {
      // dynamic 选项（看板/数据连接下拉）运行时取数 —— 不做静态白名单校验（Q26c）
      const okOpt = f.options?.some((o) => o.value === v);
      if (!okOpt) errors.push({ key: f.key, message: `${f.label} 取值非法` });
    }
  }
  return errors;
}

/** SEC3：secret 字段的明文先写入凭证库，返回值中替换为 SecretRef（配置只保存引用）。
 *  createCredential 由宿主注入（Board 走 api.createCredential），便于测试替身。
 *  编辑场景传 `original`：值仍是原 SecretRef 的 credentialRef 字符串 = 未改动，
 *  保留原引用，不重复入库。 */
export async function propsWithSecretRefs(
  schema: ConfigSchema,
  values: ConfigValues,
  createCredential: (name: string, secret: string) => Promise<{ id: string }>,
  original?: ConfigValues,
): Promise<ConfigValues> {
  const props: ConfigValues = { ...values };
  for (const f of schema) {
    if (f.type !== "secret") continue;
    const v = props[f.key];
    const orig = original?.[f.key];
    if (isSecretRef(orig) && v === (orig as SecretRef).credentialRef) {
      props[f.key] = orig;
      continue;
    }
    if (typeof v === "string" && v) {
      const cred = await createCredential(`${f.key}-${Date.now()}`, v);
      props[f.key] = { credentialRef: cred.id };
    }
  }
  return props;
}

export function fieldOf(schema: ConfigSchema, key: string): ConfigField | undefined {
  return schema.find((f) => f.key === key);
}

export function secretRefOf(v: unknown): SecretRef | null {
  return isSecretRef(v) ? (v as SecretRef) : null;
}
