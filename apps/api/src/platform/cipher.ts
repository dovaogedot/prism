/**
 * Field encryption for the personal data an order and a payment carry.
 *
 * Community Postgres has no transparent data encryption, so the API seals
 * each sensitive value before it is written. A stolen dump or backup holds
 * ciphertext; only a process with the key reads it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { z } from "zod";

/** Sealing a JSON value into bytes, and opening those bytes back into a checked value. */
export type FieldCipher = Readonly<{
  /** A fresh nonce each call, so sealing one value twice gives different bytes. */
  seal: (value: unknown) => Buffer;
  /**
   * The value `seal` was given, checked against `schema`. Throws when the
   * bytes were altered, sealed under another key, or decode to another shape.
   */
  open: <S extends z.ZodType>(bytes: Buffer, schema: S) => z.output<S>;
}>;

export const FieldCipher = {
  ALGORITHM: "aes-256-gcm",
  /** The first byte of every sealed value; a rotated key would get the next one. */
  VERSION: 1,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,

  /** A cipher under one 32-byte key. Stored bytes: version, nonce, ciphertext, tag. */
  create: (key: Buffer): FieldCipher => {
    if (key.length !== 32) throw new Error("The data encryption key must be 32 bytes.");

    return {
      seal: (value) => {
        const nonce = randomBytes(FieldCipher.NONCE_BYTES);
        const cipher = createCipheriv(FieldCipher.ALGORITHM, key, nonce);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);

        return Buffer.concat([Buffer.of(FieldCipher.VERSION), nonce, ciphertext, cipher.getAuthTag()]);
      },

      open: (bytes, schema) => {
        if (bytes.length < 1 + FieldCipher.NONCE_BYTES + FieldCipher.TAG_BYTES || bytes[0] !== FieldCipher.VERSION) {
          throw new Error("Not a sealed value.");
        }

        const nonce = bytes.subarray(1, 1 + FieldCipher.NONCE_BYTES);
        const tag = bytes.subarray(bytes.length - FieldCipher.TAG_BYTES);
        const ciphertext = bytes.subarray(1 + FieldCipher.NONCE_BYTES, bytes.length - FieldCipher.TAG_BYTES);
        const decipher = createDecipheriv(FieldCipher.ALGORITHM, key, nonce);
        decipher.setAuthTag(tag);

        // `final` throws when the tag does not match: altered bytes or another key.
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

        return schema.parse(JSON.parse(plaintext));
      },
    };
  },
} as const;
