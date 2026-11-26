import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id at the OWASP baseline: 19 MiB, 2 passes, 1 lane, 32-byte output.
 * @node-rs/argon2 ships prebuilt binaries, so no compiler is needed.
 */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { ...ARGON2, algorithm: 2 });
}

/** False for a wrong password and for a malformed hash; never throws to the caller. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2);
  } catch {
    return false;
  }
}
