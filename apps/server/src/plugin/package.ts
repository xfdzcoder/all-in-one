import { unzipSync } from "fflate";

import {
  validatePluginManifest,
  type PluginManifest,
} from "@all-in-one/widget-sdk";

/**
 * 插件包（zip）解析与校验（D24 ABI：manifest.json + entry 模块 + 可选资源）。
 * 安全基线：拒绝绝对路径 / `..` 穿越 / 隐藏段 / Windows 分隔符条目；
 * 条目数、解压后体积逐项限额（解压前用 zip 元数据先验，防 zip bomb）。
 */

export class PluginPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginPackageError";
  }
}

export interface PluginPackageLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const PLUGIN_PACKAGE_LIMITS: PluginPackageLimits = {
  maxEntries: 200,
  maxEntryBytes: 1_000_000,
  maxTotalBytes: 5_000_000,
};

/** 条目名安全：包内相对路径，无绝对/穿越/隐藏段/反斜杠/盘符。 */
function isUnsafeEntryName(name: string): boolean {
  if (!name || name.endsWith("/")) return true;
  if (name.startsWith("/") || name.includes("\\") || name.includes("..") || name.includes(":")) {
    return true;
  }
  return name.split("/").some((seg) => seg.startsWith("."));
}

export interface PluginPackage {
  manifest: PluginManifest;
  /** 包内文件（相对路径 → 内容），含 manifest.json 与 entry 模块。 */
  files: Map<string, Uint8Array>;
}

export function readPluginPackage(
  pkg: Uint8Array,
  limits: PluginPackageLimits = PLUGIN_PACKAGE_LIMITS,
): PluginPackage {
  let entries: Record<string, Uint8Array>;
  try {
    let count = 0;
    let declaredTotal = 0;
    entries = unzipSync(pkg, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false; // 目录条目
        if (isUnsafeEntryName(f.name)) {
          throw new PluginPackageError(`unsafe entry path: ${f.name}`);
        }
        count += 1;
        if (count > limits.maxEntries) throw new PluginPackageError("too many entries in package");
        if (f.originalSize > limits.maxEntryBytes) {
          throw new PluginPackageError(`entry too large: ${f.name}`);
        }
        declaredTotal += f.originalSize;
        if (declaredTotal > limits.maxTotalBytes) {
          throw new PluginPackageError("package too large (uncompressed)");
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PluginPackageError) throw e;
    throw new PluginPackageError("invalid zip package");
  }

  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (data.byteLength > limits.maxEntryBytes) {
      throw new PluginPackageError(`entry too large: ${name}`);
    }
    total += data.byteLength;
    if (total > limits.maxTotalBytes) throw new PluginPackageError("package too large (uncompressed)");
    files.set(name, data);
  }

  const rawManifest = files.get("manifest.json");
  if (!rawManifest) throw new PluginPackageError("manifest.json missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawManifest));
  } catch {
    throw new PluginPackageError("manifest.json is not valid JSON");
  }
  const errors = validatePluginManifest(parsed as PluginManifest);
  if (errors.length > 0) throw new PluginPackageError(`manifest invalid: ${errors.join("; ")}`);

  const manifest = parsed as PluginManifest;
  // CON-12：原此处再查一次 entry 安全性 —— 与 validatePluginManifest 内检（plugin.ts）完全重复，删
  if (!files.has(manifest.plugin.entry)) {
    throw new PluginPackageError(`entry module missing from package: ${manifest.plugin.entry}`);
  }
  return { manifest, files };
}
