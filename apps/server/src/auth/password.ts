import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/** SEC1: argon2id password hashing. */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (!passwordHash) return false;
  return argonVerify(passwordHash, password);
}
