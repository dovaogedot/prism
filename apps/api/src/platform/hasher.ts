/**
 * Password hashing.
 *
 * Argon2id is the memory-hard variant: it resists GPU cracking in a way that
 * bcrypt's small fixed memory footprint does not. Parameters follow the OWASP
 * Password Storage Cheat Sheet minimum (19 MiB, 2 iterations, 1 degree of
 * parallelism).
 */

import argon2 from "argon2";

export type Hasher = Readonly<{
  hash: (plaintext: string) => Promise<string>;
  /** Never throws: a malformed stored hash is a failed verification, not a crash. */
  verify: (storedHash: string, plaintext: string) => Promise<boolean>;
  /**
   * Burns comparable CPU when no account exists, so registration status cannot
   * be inferred from how quickly sign-in fails.
   */
  fakeVerify: () => Promise<void>;
}>;

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real argon2id digest of a throwaway value, hashed once at module load.
 * Verifying against it costs the same as verifying a genuine password.
 */
const decoyHash = argon2.hash("decoy-for-constant-time-signin", OPTIONS);

export const argon2Hasher: Hasher = {
  hash: (plaintext) => argon2.hash(plaintext, OPTIONS),

  // Verification reads its parameters from the stored digest, so the cost
  // settings above are deliberately not passed here — that is what lets a
  // hash written under older parameters keep verifying after a change.
  verify: (storedHash, plaintext) =>
    argon2.verify(storedHash, plaintext).catch(() => false),

  fakeVerify: async () => {
    await argon2.verify(await decoyHash, "not-the-password").catch(() => false);
  },
};
