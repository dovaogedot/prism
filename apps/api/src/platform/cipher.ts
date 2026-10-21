/**
 * Field encryption for every value in the database that identifies a person.
 *
 * Community Postgres has no transparent data encryption, so the API seals
 * each sensitive value before it is written. A stolen dump or backup holds
 * ciphertext; only a process with the key reads it. A sealed column cannot
 * be searched, so the columns a lookup needs carry a blind index beside them:
 * a keyed digest that matches equal values and reveals nothing else.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

/** The data encryption key as the environment carries it: 64 hex characters, 32 bytes. */
export const EncryptionKey = {
  schema: z.string().regex(/^[0-9a-fA-F]{64}$/, "DATA_ENCRYPTION_KEY must be 64 hex characters."),
  bytes: (hex: string): Buffer => Buffer.from(hex, "hex"),
} as const;

/** The column a blind index is computed for. Equal values index differently under two purposes. */
export type IndexPurpose = "account-email" | "order-email" | "oauth-subject";

/** A keyed digest of one value, for equality lookups on a sealed column. Only `FieldCipher.index` makes one. */
export type BlindIndex = z.infer<typeof BlindIndex.schema>;
export const BlindIndex = {
  schema: z.instanceof(Buffer).brand<"BlindIndex">(),
} as const;

/** Sealing a JSON value into bytes, opening those bytes back into a checked value, and indexing a value. */
export type FieldCipher = Readonly<{
  /** A fresh nonce each call, so sealing one value twice gives different bytes. */
  seal: (value: unknown) => Buffer;
  /**
   * The value `seal` was given, checked against `schema`. Throws when the
   * bytes were altered, sealed under another key, or decode to another shape.
   */
  open: <S extends z.ZodType>(bytes: Buffer, schema: S) => z.output<S>;
  /**
   * The blind index of `value` for `purpose`: equal for equal inputs under
   * one key, and unrelated across purposes and keys. Exact: a caller passes
   * the value in its canonical form, such as a lowercased `Email`.
   */
  index: (purpose: IndexPurpose, value: string) => BlindIndex;
}>;

export const FieldCipher = {
  ALGORITHM: "aes-256-gcm",
  /** The first byte of every sealed value; a rotated key would get the next one. */
  VERSION: 1,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,
  /** HKDF's context string for the blind-index key, so it never equals the sealing key. */
  INDEX_KEY_INFO: "prism blind index v1",

  /** A cipher under one 32-byte key. Stored bytes: version, nonce, ciphertext, tag. */
  create: (key: Buffer): FieldCipher => {
    if (key.length !== 32) throw new Error("The data encryption key must be 32 bytes.");

    const indexKey = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), FieldCipher.INDEX_KEY_INFO, 32));

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

      // The NUL keeps a purpose and a value from running together into another pair.
      index: (purpose, value) =>
        BlindIndex.schema.parse(
          createHmac("sha256", indexKey).update(`${purpose}\u0000${value.normalize("NFC")}`, "utf8").digest(),
        ),
    };
  },
} as const;
