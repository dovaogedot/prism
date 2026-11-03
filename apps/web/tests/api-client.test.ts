import { afterEach, describe, expect, it, vi } from "vitest"
import { Api } from "../src/shared/api/client.ts"
import { TokenStore } from "../src/shared/api/token-store.ts"

const refusal = (code: string) => ({ error: { code, message: "Refused.", issues: [] } })

describe("Api.isCuredByRefresh", () => {
  it("retries a request whose token was missing, expired or from an ended session", () => {
    for (const code of ["Unauthenticated", "AccessTokenInvalid", "SessionRevoked"])
      expect(Api.isCuredByRefresh(refusal(code)), code).toBe(true)
  })

  it("does not send a wrong password or code a second time", () => {
    for (const code of ["InvalidCredentials", "TwoFactorCodeInvalid"]) expect(Api.isCuredByRefresh(refusal(code)), code).toBe(false)
  })

  it("does not retry an answer it cannot read", () => {
    expect(Api.isCuredByRefresh(null)).toBe(false)
    expect(Api.isCuredByRefresh("Bad gateway")).toBe(false)
  })
})

describe("Api.refresh", () => {
  const grant = {
    accessToken: "access-token",
    expiresInSeconds: 900,
    user: {
      id: "4f6b1a52-0c5e-4f0e-9a51-6d3d8c1e2b7a",
      email: "mari@example.com",
      twoFactorEnabled: false,
      hasPassword: true,
      providers: [],
      roles: [],
      isSecondFactorVerified: false,
    },
  }

  /** Answers every request with `status`, and with `grant` when it is a 200. */
  const answerWith = (status: number): void => {
    vi.stubGlobal("fetch", async () => (status === 200 ? Response.json(grant) : new Response(null, { status })))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    TokenStore.clear()
  })

  it("holds the token a 200 grants", async () => {
    answerWith(200)

    expect(await Api.refresh()).toBe(true)
    expect(TokenStore.get()).toBe(grant.accessToken)
  })

  it("reads a 204 as signed out, and drops a token it held", async () => {
    answerWith(200)
    await Api.refresh()
    answerWith(204)

    expect(await Api.refresh()).toBe(false)
    expect(TokenStore.get()).toBeUndefined()
  })

  it("keeps the session through a refusal that is not about the cookie", async () => {
    answerWith(200)
    await Api.refresh()
    answerWith(503)

    expect(await Api.refresh()).toBe(false)
    expect(TokenStore.get()).toBe(grant.accessToken)
  })
})
