import { eq } from "drizzle-orm";

import { deleteCredentialIfOrphan } from "../credentials/store.ts";
import type { Db } from "../db/client.ts";
import { dataSource } from "../db/schema.ts";

/**
 * 退役连接类型的一次性清理（D66：OpenCode 组件与数据源下线）。
 *
 * 组件/类型白名单移除后，存量 `kind="opencode"` 行在新类型画廊里**不可见也不可管理**
 *（应用层 zod 白名单已不再接受该 kind）—— 启动时删掉这些行并回收其孤儿凭证，
 * 不留僵尸数据。**只删连接配置**，不动任何业务数据（01 §1.3：数据/视图分离）。
 */
const RETIRED_KINDS = new Set(["opencode"]);

/**
 * 从 configJson 提取凭证引用 id（SEC3 SecretRef `{ credentialRef }`）。
 * 兼容早期 `credentialId` 键名 —— 两种写法都认，拿不准就都收（回收侧保守判定是否仍被引用）。
 */
export function collectCredentialRefs(configJson: string): string[] {
  return [...configJson.matchAll(/"credential(?:Ref|Id)"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** 清理全部退役类型连接（幂等：无残留时返回 0）。返回删除的行数。 */
export async function cleanupRetiredDataSources(db: Db): Promise<number> {
  const rows = await db.select().from(dataSource);
  const retired = rows.filter((r) => RETIRED_KINDS.has(r.kind));
  for (const row of retired) {
    await db.delete(dataSource).where(eq(dataSource.id, row.id));
    // Q98b 同款：连带回收孤儿凭证（仍被邮件/其它连接/布局引用则保留）
    for (const ref of collectCredentialRefs(row.configJson)) {
      await deleteCredentialIfOrphan(db, row.userId, ref);
    }
  }
  return retired.length;
}
