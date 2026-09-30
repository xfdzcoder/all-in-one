import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { HOST_API_VERSION, type PluginManifest } from "@all-in-one/widget-sdk";

import type { Db } from "../db/client.ts";
import { plugin as pluginTable, type Plugin } from "../db/schema.ts";
import { readPluginPackage } from "./package.ts";

/**
 * 插件安装 / 卸载（FR-W6）。安装 = 解包校验 → 落盘 dataDir/plugins/<dir>/ → 登记；
 * 卸载 = 删目录 + 删登记（**不触碰任何业务数据**，01 §1.3 数据/视图分离）。
 */

/** 内置组件类型（与 apps/web/src/widget-registry.ts 的 key 保持同步）——插件不得占用。 */
const BUILTIN_TYPES = new Set([
  "todo",
  "rss",
  "kanban",
  "mail",
  "opencode",
  "monitor",
  "app-launcher",
  "iframe",
  "custom-api",
  "placeholder",
  "stat-box",
  "Placeholder",
  "StatBox",
]);

export class PluginInstallError extends Error {
  /** HTTP 状态码建议（409 = 冲突，400 = 校验失败）。 */
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PluginInstallError";
    this.status = status;
  }
}

export interface PluginInstallOptions {
  /** 插件安装根目录（通常 <dataDir>/plugins）。 */
  pluginsRoot: string;
}

function majorOf(version: string): string {
  return version.split(".")[0] ?? "";
}

/** 安装目录必须落在 pluginsRoot 内（防篡改路径逃逸）。 */
function resolvePluginDir(pluginsRoot: string, dirName: string): string {
  const root = path.resolve(pluginsRoot);
  const target = path.resolve(root, dirName);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new PluginInstallError(`unsafe plugin dir: ${dirName}`);
  }
  return target;
}

export async function installPlugin(
  db: Db,
  userId: string,
  pkg: Uint8Array,
  opts: PluginInstallOptions,
): Promise<Plugin> {
  const { manifest, files } = readPluginPackage(pkg);
  const type = manifest.type;
  if (BUILTIN_TYPES.has(type)) throw new PluginInstallError(`type is reserved by built-in widgets: ${type}`);
  if (majorOf(manifest.plugin.apiVersion) !== majorOf(HOST_API_VERSION)) {
    throw new PluginInstallError(
      `plugin.apiVersion ${manifest.plugin.apiVersion} incompatible with host ${HOST_API_VERSION}`,
    );
  }
  const existing = await db.select().from(pluginTable).where(eq(pluginTable.type, type)).limit(1);
  if (existing.length > 0) throw new PluginInstallError(`type already installed: ${type}`, 409);

  const id = crypto.randomUUID();
  const dirName = `${type}-${id.slice(0, 8)}`;
  const dir = resolvePluginDir(opts.pluginsRoot, dirName);
  mkdirSync(dir, { recursive: true });
  try {
    for (const [name, data] of files) {
      const target = resolvePluginDir(dir, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e instanceof PluginInstallError ? e : new PluginInstallError("failed to write plugin files");
  }

  await db.insert(pluginTable).values({
    id,
    userId,
    type,
    name: manifest.name,
    manifestJson: JSON.stringify(manifest),
    dir: dirName,
    status: "installed",
    createdAt: new Date(),
  });
  const row = await db.select().from(pluginTable).where(eq(pluginTable.id, id)).limit(1);
  return row[0];
}

export async function listPlugins(db: Db, userId: string): Promise<Plugin[]> {
  return db.select().from(pluginTable).where(eq(pluginTable.userId, userId));
}

export async function getPlugin(db: Db, userId: string, id: string): Promise<Plugin | null> {
  const rows = await db
    .select()
    .from(pluginTable)
    .where(and(eq(pluginTable.id, id), eq(pluginTable.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** 启用 / 禁用（FR-W6）。启用时复核 apiVersion 主版本（D24：不一致拒绝启用）。 */
export async function setPluginStatus(
  db: Db,
  userId: string,
  id: string,
  status: "enabled" | "disabled",
): Promise<Plugin | null> {
  const row = await getPlugin(db, userId, id);
  if (!row) return null;
  if (status === "enabled") {
    const manifest = JSON.parse(row.manifestJson) as PluginManifest;
    if (majorOf(manifest.plugin.apiVersion) !== majorOf(HOST_API_VERSION)) {
      throw new PluginInstallError(
        `plugin.apiVersion ${manifest.plugin.apiVersion} incompatible with host ${HOST_API_VERSION}`,
      );
    }
  }
  await db.update(pluginTable).set({ status }).where(eq(pluginTable.id, id));
  const rows = await db.select().from(pluginTable).where(eq(pluginTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 卸载（FR-W6）：删安装目录 + 删登记行。返回 false = 不存在/非本人。 */
export async function uninstallPlugin(
  db: Db,
  userId: string,
  id: string,
  opts: PluginInstallOptions,
): Promise<boolean> {
  const row = await getPlugin(db, userId, id);
  if (!row) return false;
  rmSync(resolvePluginDir(opts.pluginsRoot, row.dir), { recursive: true, force: true });
  await db.delete(pluginTable).where(eq(pluginTable.id, id));
  return true;
}

/**
 * 读取插件入口模块源码 + manifest（供宿主沙箱加载器注入，D25）。
 * 源码以 JSON 数据形式返回（绝不以 JS 内容型下发，避免被浏览器当作可执行资源）。
 */
export function readPluginEntry(
  row: Plugin,
  opts: PluginInstallOptions,
): { manifest: PluginManifest; code: string } {
  const manifest = JSON.parse(row.manifestJson) as PluginManifest;
  const dir = resolvePluginDir(opts.pluginsRoot, row.dir);
  const code = readFileSync(resolvePluginDir(dir, manifest.plugin.entry), "utf8");
  return { manifest, code };
}
