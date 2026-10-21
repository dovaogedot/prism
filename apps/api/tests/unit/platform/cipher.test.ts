import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FieldCipher } from "../../../src/platform/cipher.ts";

const key = Buffer.from("0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0", "hex");
const cipher = FieldCipher.create(key);
const contact = z.object({ fullName: z.string(), email: z.string() });
const value = { fullName: "Mari Maasikas", email: "mari@example.com" };

describe("FieldCipher", () => {
  it("opens what it sealed", () => {
    expect(cipher.open(cipher.seal(value), contact)).toEqual(value);
  });

  it("never shows the plaintext in the sealed bytes", () => {
    const sealed = cipher.seal(value).toString("latin1");

    expect(sealed).not.toContain("Mari");
    expect(sealed).not.toContain("example.com");
  });

  it("uses a fresh nonce each time, so equal values seal differently", () => {
    const first = cipher.seal(value);
    const second = cipher.seal(value);

    expect(first.equals(second)).toBe(false);
    expect(first.subarray(1, 1 + FieldCipher.NONCE_BYTES).equals(second.subarray(1, 1 + FieldCipher.NONCE_BYTES))).toBe(
      false,
    );
  });

  it("starts every sealed value with the version byte", () => {
    expect(cipher.seal(value)[0]).toBe(FieldCipher.VERSION);
  });

  it("refuses bytes altered anywhere after the version", () => {
    const sealed = cipher.seal(value);

    for (const position of [1, 1 + FieldCipher.NONCE_BYTES, sealed.length - 1]) {
      const altered = Buffer.from(sealed);
      altered[position] = (altered[position] ?? 0) ^ 0x01;

      expect(() => cipher.open(altered, contact), String(position)).toThrow();
    }
  });

  it("refuses bytes sealed under another key", () => {
    const other = FieldCipher.create(randomBytes(32));
    expect(() => other.open(cipher.seal(value), contact)).toThrow();
  });

  it("refuses a value that decrypts to the wrong shape", () => {
    expect(() => cipher.open(cipher.seal({ fullName: 1 }), contact)).toThrow();
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => FieldCipher.create(randomBytes(16))).toThrow();
  });
});

describe("FieldCipher.index", () => {
  it("gives one input the same index every time", () => {
    expect(cipher.index("account-email", "mari@example.com").equals(cipher.index("account-email", "mari@example.com"))).toBe(
      true,
    );
  });

  it("gives different inputs different indexes", () => {
    expect(cipher.index("account-email", "mari@example.com").equals(cipher.index("account-email", "jaan@example.com"))).toBe(
      false,
    );
  });

  it("gives one input a different index for each purpose", () => {
    const account = cipher.index("account-email", "mari@example.com");
    const order = cipher.index("order-email", "mari@example.com");

    expect(account.equals(order)).toBe(false);
  });

  it("gives one input a different index under another key", () => {
    const other = FieldCipher.create(randomBytes(32));

    expect(cipher.index("account-email", "mari@example.com").equals(other.index("account-email", "mari@example.com"))).toBe(
      false,
    );
  });

  it("never shows the value in the index", () => {
    const index = cipher.index("account-email", "mari@example.com");

    expect(index).toHaveLength(32);
    expect(index.toString("latin1")).not.toContain("mari");
  });

  it("indexes the composed and decomposed forms of a character alike", () => {
    expect(cipher.index("oauth-subject", "é").equals(cipher.index("oauth-subject", "é"))).toBe(true);
  });
});
