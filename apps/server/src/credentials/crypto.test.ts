import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, generateMasterKeyBase64, loadMasterKey } from "./crypto.ts";

describe("credential crypto (SEC3)", () => {
  it("round-trips secrets with AES-256-GCM", () => {
    const key = Buffer.from(generateMasterKeyBase64(), "base64");
    const cipher = encryptSecret("sk-super-secret", key);
    expect(cipher).not.toContain("sk-super-secret");
    expect(decryptSecret(cipher, key)).toBe("sk-super-secret");
  });

  it("produces different ciphertext per call (random IV)", () => {
    const key = Buffer.from(generateMasterKeyBase64(), "base64");
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("fails to decrypt with wrong key (auth tag)", () => {
    const key = Buffer.from(generateMasterKeyBase64(), "base64");
    const other = Buffer.from(generateMasterKeyBase64(), "base64");
    const cipher = encryptSecret("x", key);
    expect(() => decryptSecret(cipher, other)).toThrow();
  });

  it("loadMasterKey requires 32-byte base64 env", () => {
    const saved = process.env.CREDENTIALS_MASTER_KEY;
    try {
      delete process.env.CREDENTIALS_MASTER_KEY;
      expect(() => loadMasterKey()).toThrow(/CREDENTIALS_MASTER_KEY/);
      process.env.CREDENTIALS_MASTER_KEY = Buffer.alloc(16).toString("base64");
      expect(() => loadMasterKey()).toThrow(/CREDENTIALS_MASTER_KEY/);
      process.env.CREDENTIALS_MASTER_KEY = generateMasterKeyBase64();
      expect(loadMasterKey().length).toBe(32);
    } finally {
      if (saved === undefined) delete process.env.CREDENTIALS_MASTER_KEY;
      else process.env.CREDENTIALS_MASTER_KEY = saved;
    }
  });
});
