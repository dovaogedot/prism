import { OtpauthUri } from "@prism/shared"
import { describe, expect, it } from "vitest"
import { SetupKey } from "../src/features/auth/setup-key.ts"

describe("the setup key typed into an authenticator app", () => {
  it("is the URI's secret alone, in groups of four", () => {
    const uri = OtpauthUri.schema.parse("otpauth://totp/Prism:mari%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Prism")

    expect(SetupKey.of(uri)).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP")
  })

  it("is absent from a URI without a secret", () => {
    expect(SetupKey.of(OtpauthUri.schema.parse("otpauth://totp/Prism:mari%40example.com?issuer=Prism"))).toBeUndefined()
  })
})
