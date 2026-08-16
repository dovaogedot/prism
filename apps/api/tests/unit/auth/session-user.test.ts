/**
 * `withProvider` covers the one moment the database cannot: the session issued
 * by the very request that links a provider. The record was read before the
 * identity row was written, so it is a provider short until this puts it back.
 */

import { describe, expect, it } from "vitest";
import { Option } from "@prism/shared";
import { withProvider } from "../../../src/modules/auth/service.ts";
import type { UserRecord } from "../../../src/modules/auth/repository.ts";

const account = (providers: readonly string[]): UserRecord => ({
  id: "00000000-0000-0000-0000-000000000001",
  email: "a@example.com",
  passwordHash: Option.none,
  role: "customer",
  totpSecret: Option.none,
  totpEnabledAt: Option.none,
  providers,
  createdAt: new Date(0),
});

describe("withProvider", () => {
  it("adds a provider the account did not have", () => {
    expect(withProvider(account([]), "github").providers).toEqual(["github"]);
  });

  it("keeps the providers alphabetical, as the query returns them", () => {
    expect(withProvider(account(["google"]), "github").providers).toEqual([
      "github",
      "google",
    ]);
  });

  it("does not duplicate one that is already linked", () => {
    // Signing in again with the same provider goes through the same path.
    expect(withProvider(account(["google"]), "google").providers).toEqual(["google"]);
  });

  it("leaves the rest of the record alone", () => {
    const before = account(["google"]);
    const after = withProvider(before, "github");

    expect(after.email).toBe(before.email);
    expect(after.id).toBe(before.id);
    expect(before.providers).toEqual(["google"]);
  });
});
