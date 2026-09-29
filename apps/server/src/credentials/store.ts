import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.ts";
import { credential, type Credential } from "../db/schema.ts";
import { decryptSecret, encryptSecret, loadMasterKey } from "./crypto.ts";

/**
 * SEC3 凭证仓库服务：加密存取第三方凭证。
 * 明文只在 readSecret() 返回值中短暂出现（供 connector 使用），
 * 永不写日志、永不下发前端；API 层只操作 name/kind/id。
 */

export type CredentialView = Pick<Credential, "id" | "name" | "kind" | "createdAt" | "updatedAt">;

function toView(row: Credential): CredentialView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createCredential(
  db: Db,
  userId: string,
  name: string,
  kind: string,
  plaintext: string,
): Promise<CredentialView> {
  const key = loadMasterKey();
  const now = new Date();
  const [row] = await db
    .insert(credential)
    .values({
      id: randomBytes(12).toString("hex"),
      userId,
      name,
      kind,
      cipherText: encryptSecret(plaintext, key),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toView(row!);
}

export async function listCredentials(db: Db, userId: string): Promise<CredentialView[]> {
  const rows = await db.select().from(credential).where(eq(credential.userId, userId));
  return rows.map(toView);
}

/** 凭证件元数据（id/kind，不含密文）——插件 credentialKinds 白名单把关用（FR-W7）。 */
export async function getCredentialMeta(
  db: Db,
  userId: string,
  credentialId: string,
): Promise<{ id: string; kind: string } | null> {
  const rows = await db
    .select({ id: credential.id, kind: credential.kind })
    .from(credential)
    .where(and(eq(credential.id, credentialId), eq(credential.userId, userId)));
  return rows[0] ?? null;
}

/** 解密读取明文 —— 仅供服务端 connector 调用，严禁出现在 API 响应/日志。 */
export async function readSecret(
  db: Db,
  userId: string,
  credentialId: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(credential)
    .where(and(eq(credential.id, credentialId), eq(credential.userId, userId)));
  const row = rows[0];
  if (!row) return null;
  return decryptSecret(row.cipherText, loadMasterKey());
}

export async function deleteCredential(
  db: Db,
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const [row] = await db
    .delete(credential)
    .where(and(eq(credential.id, credentialId), eq(credential.userId, userId)))
    .returning();
  return Boolean(row);
}
