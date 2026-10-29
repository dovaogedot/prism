import { DomainError } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { SignInFailure } from "../src/features/auth/sign-in-failure.ts";

describe("the reason a provider sign-in failed, as the sign-in page says it", () => {
  it("is the shop's own sentence for a failure it knows", () => {
    expect(SignInFailure.messageOf("OAuthCanceled")).toBe(DomainError.message.OAuthCanceled);
    expect(SignInFailure.messageOf("AccountDisabled")).toBe(DomainError.message.AccountDisabled);
  });

  it("is one fixed sentence for anything else a link puts in the address", () => {
    for (const code of ["Call +1 555 0100 to unlock your account", "toString", "__proto__", ""]) {
      expect(SignInFailure.messageOf(code), code).toBe(SignInFailure.UNKNOWN);
    }
  });
});
