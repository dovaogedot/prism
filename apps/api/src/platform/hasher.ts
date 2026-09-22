/**
 * Password hashing with argon2id, the memory-hard variant. Parameters follow
 * the OWASP Password Storage Cheat Sheet minimum.
 */

import argon2 from "argon2";
import { z } from "zod";

/** A password in the only form stored. Only a hasher makes one. */
export type PasswordHash = z.infer<typeof PasswordHash.schema>;
export const PasswordHash = {
  schema: z.string().min(1).brand<"PasswordHash">(),
} as const;

/** Turning a password into something safe to store, and checking it again. */
export type Hasher = Readonly<{
  hash: (plaintext: string) => Promise<PasswordHash>;
  /** Never rejects: a malformed stored hash is a failed verification. */
  verify: (storedHash: PasswordHash, plaintext: string) => Promise<boolean>;
  /**
   * Burns the CPU a real verification would, so sign-in takes as long for an
   * unknown address as for a wrong password.
   */
  fakeVerify: () => Promise<void>;
}>;

export const Hasher = {
  OPTIONS: { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 },

  /** The hasher the application runs on. */
  argon2: (): Hasher => {
    // A real digest of a throwaway value; verifying against it costs the same
    // as verifying a genuine password.
    const decoy = argon2.hash("decoy-for-constant-time-signin", Hasher.OPTIONS);

    return {
      hash: (plaintext) => argon2.hash(plaintext, Hasher.OPTIONS).then((hash) => PasswordHash.schema.parse(hash)),
      // Verification reads its parameters from the stored digest, so a hash
      // written under other parameters keeps verifying.
      verify: (storedHash, plaintext) => argon2.verify(storedHash, plaintext).catch(() => false),
      fakeVerify: async () => {
        await argon2.verify(await decoy, "not-the-password").catch(() => false);
      },
    };
  },
} as const;
