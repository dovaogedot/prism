/**
 * `UserRecord.withProvider` covers the one moment the database cannot: the
 * session issued by the very request that links a provider, whose record was
 * read before the identity row was written.
 */

import { Email, UserId, type OAuthProvider } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { UserRecord } from "../../../src/modules/auth/repository.ts";
import { PasswordHash } from "../../../src/platform/hasher.ts";
import { TotpSecret } from "../../../src/platform/totp.ts";

const ID = UserId.schema.parse("11111111-1111-4111-8111-111111111111");
const EMAIL = Email.schema.parse("a@example.com");

const account = (providers: readonly OAuthProvider[]): UserRecord => ({
  id: ID,
  email: EMAIL,
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
    });
  });

  it("maps a null column to an absent field", () => {
    const record = UserRecord.fromRow({
      id: ID,
      email: EMAIL,
      passwordHash: null,
      totpSecret: null,
      totpEnabledAt: null,
      createdAt: new Date(0),
      providers: [],
    });

    expect(record).not.toHaveProperty("passwordHash");
    expect(UserRecord.toSessionUser(record).hasPassword).toBe(false);
  });
});
