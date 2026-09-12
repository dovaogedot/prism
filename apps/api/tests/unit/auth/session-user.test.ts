/**
 * `UserRecord.withProvider` covers the one moment the database cannot: the
 * session issued by the very request that links a provider, whose record was
 * read before the identity row was written.
 */

import { describe, expect, it } from "vitest";
import { UserRecord } from "../../../src/modules/auth/repository.ts";

const account = (providers: readonly string[]): UserRecord => ({
  id: "00000000-0000-0000-0000-000000000001",
  email: "a@example.com",
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
      passwordHash: "hash",
      totpSecret: "secret",
      totpEnabledAt: new Date(0),
    });

    expect(user).toEqual({
      id: "00000000-0000-0000-0000-000000000001",
      email: "a@example.com",
      twoFactorEnabled: true,
      hasPassword: true,
      providers: ["google"],
    });
  });

  it("maps a null column to an absent field", () => {
    const record = UserRecord.fromRow({
      id: "id",
      email: "a@example.com",
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
