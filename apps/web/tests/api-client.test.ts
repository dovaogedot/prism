import { describe, expect, it } from "vitest";
import { Api } from "../src/shared/api/client.ts";

const refusal = (code: string) => ({ error: { code, message: "Refused.", issues: [] } });

describe("Api.isCuredByRefresh", () => {
  it("retries a request whose token was missing, expired or from an ended session", () => {
    for (const code of ["Unauthenticated", "AccessTokenInvalid", "SessionRevoked"]) expect(Api.isCuredByRefresh(refusal(code)), code).toBe(true);
  });

  it("does not send a wrong password or code a second time", () => {
    for (const code of ["InvalidCredentials", "TwoFactorCodeInvalid"]) expect(Api.isCuredByRefresh(refusal(code)), code).toBe(false);
  });

  it("does not retry an answer it cannot read", () => {
    expect(Api.isCuredByRefresh(null)).toBe(false);
    expect(Api.isCuredByRefresh("Bad gateway")).toBe(false);
  });
});
