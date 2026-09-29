import type { PluginManifest } from "@all-in-one/widget-sdk";

import type { Db } from "../db/client.ts";
import { plugin as pluginTable, type Plugin } from "../db/schema.ts";
import type { FetchContext, WidgetDataQuery } from "../connector/registry.ts";
import { httpConnector } from "../connector/http.ts";
import { getCredentialMeta } from "../credentials/store.ts";
import { and, eq } from "drizzle-orm";

/**
 * 插件数据桥（FR-W3/FR-W7，D26）：插件数据一律走宿主统一数据通道，
 * 服务端按 manifest 权限白名单放行：
 * - 数据源白名单：v1 仅 `http-connector` / `none`（插件 config 键沿用 http connector
 *   约定：url / apiToken / authHeader / headers / method / body）；
 * - `permissions.apis` 须含 `"widgets.data"` 才可取数（FR-W7 可访问 API）；
 * - `permissions.credentialKinds` 按凭证件 `kind` 逐个把关 —— 未声明的 kind 直接拒绝
 *   （凭证明文只在服务端 connector 内解密，SEC3 不变）。
 */

export class PluginPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginPermissionError";
  }
}

export async function getEnabledPluginByType(
  db: Db,
  userId: string,
  type: string,
): Promise<Plugin | null> {
  const rows = await db
    .select()
    .from(pluginTable)
    .where(and(eq(pluginTable.type, type), eq(pluginTable.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row && row.status === "enabled" ? row : null;
}

/** 插件数据查询：权限校验 + 按 capabilities.data.source 路由到宿主 connector。 */
export async function fetchPluginData(
  db: Db,
  userId: string,
  query: WidgetDataQuery,
  ctx: FetchContext,
): Promise<unknown> {
  const row = await getEnabledPluginByType(db, userId, query.type);
  if (!row) throw new PluginPermissionError("plugin not installed or disabled");
  const manifest = JSON.parse(row.manifestJson) as PluginManifest;

  const source = manifest.capabilities?.data?.source ?? "none";
  if (source === "none") throw new PluginPermissionError("plugin declares no data source");
  if (source !== "http-connector") {
    throw new PluginPermissionError(`unsupported plugin data source: ${source}`);
  }

  const perms = manifest.plugin.permissions ?? {};
  if (!(perms.apis ?? []).includes("widgets.data")) {
    throw new PluginPermissionError("permission denied: widgets.data not declared");
  }

  // credentialKinds：SecretRef 解析阶段按凭证件 kind 把关（未声明即拒绝）
  const guarded: FetchContext = {
    ...ctx,
    readSecret: async (credentialId) => {
      const meta = await getCredentialMeta(db, userId, credentialId);
      const kinds = perms.credentialKinds ?? [];
      if (meta && !kinds.includes(meta.kind)) {
        throw new PluginPermissionError(`permission denied: credential kind ${meta.kind} not declared`);
      }
      return ctx.readSecret(credentialId);
    },
  };
  return httpConnector.fetch(query, guarded);
}
