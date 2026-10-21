/**
 * `UserRecord.withProvider` covers the one moment the database cannot: the
 * session issued by the very request that links a provider, whose record was
 * read before the identity row was written.
 */

import { Email, UserId, type OAuthProvider } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { UserRecord } from "../../../src/modules/auth/repository.ts";
import { FieldCipher } from "../../../src/platform/cipher.ts";
import { PasswordHash } from "../../../src/platform/hasher.ts";
import { TotpSecret } from "../../../src/platform/totp.ts";

const ID = UserId.schema.parse("11111111-1111-4111-8111-111111111111");
const EMAIL = Email.schema.parse("a@example.com");

const account = (providers: readonly OAuthProvider[]): UserRecord => ({
  id: ID,
  email: EMAIL,
  roles: [],
  providers,
  createdAt: new Date(0),
});

describe("UserRecord.withProvider", () => {
  it("adds a provider the account did not have", () => {
    expect(UserRecord.withProvider(account([]), "github").providers).toEqual(["github"]);
  });

  it("keeps the providers alphabetical, as the query returns them", () => {
    expect(UserRecord.withProvider(account(["google"]), "github").providers).toEqual(["github", "google"]);
  });

  it("does not duplicate one that is already linked", () => {
    expect(UserRecord.withProvider(account(["google"]), "google").providers).toEqual(["google"]);
  });

  it("leaves the rest of the record alone", () => {
    const before = account(["google"]);
    const after = UserRecord.withProvider(before, "github");

    expect(after.email).toBe(before.email);
    expect(before.providers).toEqual(["google"]);
  });
});

describe("UserRecord.toSessionUser", () => {
  it("reports the flags without either secret", () => {
    const user = UserRecord.toSessionUser({
      ...account(["google"]),
      passwordHash: PasswordHash.schema.parse("hash"),
      totpSecret: TotpSecret.schema.parse("secret"),
      totpEnabledAt: new Date(0),
    });

    expect(user).toEqual({
      id: ID,
      email: EMAIL,
      twoFactorEnabled: true,
      hasPassword: true,
      providers: ["google"],
      roles: [],
      isSecondFactorVerified: false,
    });
  });

  it("maps a null column to an absent field, and opens the sealed ones", () => {
    const cipher = FieldCipher.create(Buffer.alloc(32, 7));
    const record = UserRecord.fromRow(
      {
        id: ID,
        email: cipher.seal(EMAIL),
        emailIndex: cipher.index("account-email", EMAIL),
        passwordHash: null,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        roles: [],
        fullName: null,
        phone: null,
        disabledAt: null,
        createdAt: new Date(0),
        providers: [],
      },
      cipher,
    );

    expect(record.email).toBe(EMAIL);
    expect(record).not.toHaveProperty("passwordHash");
    expect(record).not.toHaveProperty("totpSecret");
    expect(record).not.toHaveProperty("disabledAt");
    expect(UserRecord.toSessionUser(record).hasPassword).toBe(false);
  });
});
