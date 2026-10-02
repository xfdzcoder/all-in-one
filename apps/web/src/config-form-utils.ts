import type { ConfigSchema, ConfigValues, SecretRef } from "@all-in-one/widget-sdk";
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

/** D65（用户反馈⑤，2026-10-02）：连接配置合并（**纯函数**，`useResolvedSourceConfig` 委托实现）。
 *
 * - `inlineWins`（图表/自定义 API 的认证键语义）：**卡片已填 > 来源**，空值才回落来源 ——
 *   「与认证来源不同才需填写；填了只覆盖本卡，不修改来源配置」；缺省 `false` = 来源优先、
 *   内联回落（D42 旧语义，monitor 等的兼容路径不动）。
 * - `resolveRelativeUrl`：相对 `url`（无 scheme）按来源的站点地址拼接 —— 「接口地址」不再
 *   要求带域名的绝对地址（来源已有绝对地址）；无来源或拼不出则原样保留（下游报「原因+怎么修」）。 */
const isEmptyValue = (v: unknown) => v === undefined || v === null || v === "";

export function resolveSourceConfig<T extends Record<string, unknown>>(
  config: T,
  sourceConfig: Record<string, unknown>,
  pick?: string[],
  opts: { inlineWins?: boolean; resolveRelativeUrl?: boolean } = {},
): T {
  const from = pick
    ? Object.fromEntries(Object.entries(sourceConfig).filter(([k]) => pick.includes(k)))
    : sourceConfig;
  // inlineWins：**来源只补空位** —— 卡片已填值原样保留（覆盖来源），空值才用来源
  // （「与来源不同才需填写；填了只覆盖本卡」）；缺省 = 来源优先、内联回落（D42 旧语义）
  const merged = (
    opts.inlineWins
      ? { ...config, ...Object.fromEntries(Object.entries(from).filter(([k]) => isEmptyValue(config[k]))) }
      : { ...config, ...from }
  ) as Record<string, unknown>;
  if (opts.resolveRelativeUrl) {
    const rel = typeof merged.url === "string" ? merged.url : "";
    const base = typeof sourceConfig.url === "string" ? sourceConfig.url : "";
    if (rel && base && !/^[a-z][a-z0-9+.-]*:/i.test(rel)) {
      try {
        merged.url = new URL(rel, base).toString();
      } catch {
        /* 来源地址畸形：原样保留，由取数层按「原因 + 怎么修」报错 */
      }
    }
  }
  return merged as T;
}

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



/** WEB-2（Q98c）：提交前的配置清洗。
 *  - `undefined` 一律剔除（未改动的字段不发）；
 *  - **secret 字段**的空串仍剔除 —— 维持「口令留空 = 不改」（Q27a）语义；
 *  - **文本/数字/下拉字段**的空串**保留** —— 服务端 PATCH 是合并语义，丢掉空串就永远清不空
 *    （最危险是 Portainer `restartAllow`：清空「重启白名单」想禁重启，旧白名单却还在，D51 失效）。 */
export function configForSubmit(
  schema: Array<{ key: string; type?: string }>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretKeys = new Set(schema.filter((f) => f.type === "secret").map((f) => f.key));
  return Object.fromEntries(
    Object.entries(config).filter(([k, v]) => v !== undefined && (secretKeys.has(k) ? v !== "" : true)),
  );
}

/** WEB-5（Q98c）：`tagIds` 入参防呆（配置可能存过空串/非数组畸形值）——查询与手动刷新必须用同一份清洗结果。 */
export function normalizeTagIds(tagIds: unknown): string[] {
  return Array.isArray(tagIds) ? tagIds.filter((x): x is string => typeof x === "string") : [];
}
