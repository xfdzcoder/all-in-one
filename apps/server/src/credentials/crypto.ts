import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * SEC3 Credential Store：第三方凭证（邮箱密码、API token）加密落库。
 * - 算法 AES-256-GCM（随文 iv + auth tag）
 * - 主密钥来自 CREDENTIALS_MASTER_KEY 环境变量（base64 32 字节），永不入库
 * - 明文只在服务端 connector 取用瞬间出现：不落日志、不下发前端
 */

const ALGO = "aes-256-gcm";

class MissingMasterKeyError extends Error {
  constructor() {
    super("CREDENTIALS_MASTER_KEY env var is required (base64-encoded 32 bytes)");
    this.name = "MissingMasterKeyError";
  }
}

export function loadMasterKey(): Buffer {
  const raw = process.env.CREDENTIALS_MASTER_KEY;
  if (!raw) throw new MissingMasterKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new MissingMasterKeyError();
  }
  return key;
}

/** 生成一个新的主密钥（部署时 `node -e` 一次性生成用）。 */
export function generateMasterKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

/** 密文格式：base64(iv[12] | authTag[16] | ciphertext)。 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(encoded: string, key: Buffer): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
