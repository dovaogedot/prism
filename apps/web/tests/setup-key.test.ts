import { OtpauthUri } from "@prism/shared"
import { describe, expect, it } from "vitest"
import { SetupKey } from "../src/features/auth/setup-key.ts"

describe("the setup key typed into an authenticator app", () => {
  it("is the URI's secret alone, in groups of four that join back into it", () => {
    const uri = OtpauthUri.schema.parse("otpauth://totp/Prism:mari%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Prism")

    expect(SetupKey.splitIntoGroups(uri)).toEqual(["JBSW", "Y3DP", "EHPK", "3PXP", "JBSW", "Y3DP", "EHPK", "3PXP"])
    expect(SetupKey.splitIntoGroups(uri)?.join("")).toBe("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")
  })

  it("is absent from a URI without a secret", () => {
    expect(SetupKey.splitIntoGroups(OtpauthUri.schema.parse("otpauth://totp/Prism:mari%40example.com?issuer=Prism"))).toBeUndefined()
  })
})
