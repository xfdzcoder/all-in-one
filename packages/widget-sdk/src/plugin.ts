import type { WidgetManifest } from "./manifest.ts";
import { validateManifest } from "./manifest.ts";

/**
 * 代码级插件 ABI（FR-W5③/FR-W6/FR-W7，D7"契约先行、实现分层"）。
 *
 * 信任模型（K7）：仅管理员安装；权限显式声明、默认最小化；插件只做**前端渲染**，
 * 数据一律走宿主统一数据通道（FR-W3），不直连第三方、不持有凭证明文。
 * 沙箱隔离（iframe CSP / Web Component）是宿主加载器职责，落地选型随运行时
 * 实现记录决策；本文件只冻结 ABI（包格式 / 权限语义 / 版本兼容）。
 */

/** 权限声明（FR-W7）：显式白名单，缺省 = 最小权限。 */
export interface PluginPermissions {
  /** 可调用的宿主 API 白名单（如 "widgets.data"、"feeds.read"）；缺省 = 仅数据通道。 */
  apis?: string[];
  /** 可引用的凭证类型白名单（如 "http-header"、"basic"）；缺省 = 不可使用凭证。 */
  credentialKinds?: string[];
  /** 可派发的动作域白名单（如 "todo.toggle"）；缺省 = 无动作。 */
  actions?: string[];
}

/** 代码级插件 manifest = 常规 widget 契约 + 插件块。 */
export interface PluginManifest extends WidgetManifest {
  plugin: {
    /** 插件包内入口模块相对路径（ESM，导出 WidgetComponent）。 */
    entry: string;
    /** 目标宿主 ABI 版本（semver；主版本须与宿主一致才可启用）。 */
    apiVersion: string;
    /** 权限声明（FR-W7）。 */
    permissions?: PluginPermissions;
  };
}

const PERMISSION_KEYS = ["apis", "credentialKinds", "actions"] as const;
/** 包内相对模块路径形状：仅字母数字._- 与 / 分段、以 .js/.mjs 结尾。 */
export const PLUGIN_ENTRY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.m?js$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** 宿主 ABI 版本（D24）：插件 plugin.apiVersion 的主版本须与之一致才可安装/启用。 */
export const HOST_API_VERSION = "1.0.0";

/** 入口路径安全：形状合法 + 禁止 `.`/`..`/隐藏段（绝对路径与穿越均被拒）。 */
export function isSafePluginEntry(entry: string): boolean {
  return (
    PLUGIN_ENTRY_PATTERN.test(entry) && !entry.split("/").some((seg) => seg.startsWith("."))
  );
}

export function isPluginManifest(m: WidgetManifest): m is PluginManifest {
  if (!m || typeof m !== "object") return false; // SDK-1：null 不崩
  const p = (m as PluginManifest).plugin;
  return p !== undefined && p !== null;
}

/** 插件契约校验（供安装器 FR-W6 与单元测试复用）：常规 manifest 校验 + 插件块。 */
export function validatePluginManifest(m: PluginManifest): string[] {
  if (!m || typeof m !== "object") return ["manifest must be an object"]; // SDK-1：null 不崩
  const errors = validateManifest(m);
  const p = m.plugin;
  if (!p || typeof p !== "object") {
    errors.push(`${m.type}: missing plugin block`);
    return errors;
  }
  if (!p.entry) {
    errors.push(`${m.type}: plugin.entry required`);
  } else if (!isSafePluginEntry(p.entry)) {
    errors.push(`${m.type}: plugin.entry must be a relative module path (no absolute/traversal)`);
  }
  if (!SEMVER_PATTERN.test(p.apiVersion ?? "")) {
    errors.push(`${m.type}: plugin.apiVersion must be semver (x.y.z)`);
  }
  const perms = p.permissions ?? {};
  for (const key of Object.keys(perms)) {
    if (!(PERMISSION_KEYS as readonly string[]).includes(key)) {
      errors.push(`${m.type}: unknown plugin.permissions.${key}`);
    }
  }
  for (const key of PERMISSION_KEYS) {
    const v = perms[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((s) => typeof s !== "string" || !s.trim())) {
      errors.push(`${m.type}: plugin.permissions.${key} must be a list of non-empty strings`);
    }
  }
  return errors;
}
