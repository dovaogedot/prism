/**
 * REQUIREMENTS_1.md: "Refresh token rotation is implemented with single-use
 * validation. Verify that each refresh token can only be used once and new
 * refresh token is issued with each refresh. Old refresh tokens must be
 * rejected."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { jsonOf, registerUser, requiredCookie, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
})

const refresh = (token: string) => harness.app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { prism_refresh: token } })

describe("refreshing a session", () => {
  it("issues a new refresh token with every refresh, beside a working access token", async () => {
    const { refreshToken: first } = await registerUser(harness, "pat@example.com")

    const firstRefresh = await refresh(first)
    const second = requiredCookie(firstRefresh, "prism_refresh")
    const secondRefresh = await refresh(second)
    const third = requiredCookie(secondRefresh, "prism_refresh")
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${String(jsonOf(secondRefresh)["accessToken"])}` },
    })

    expect([firstRefresh.statusCode, secondRefresh.statusCode]).toEqual([200, 200])
    expect(new Set([first, second, third]).size).toBe(3)
    expect(me.statusCode).toBe(200)
  })

  it("accepts each refresh token once, and rejects it the second time", async () => {
    const { refreshToken } = await registerUser(harness, "pat@example.com")

    const firstUse = await refresh(refreshToken)
    const secondUse = await refresh(refreshToken)

    expect(firstUse.statusCode).toBe(200)
    expect(secondUse.statusCode).toBe(401)
    expect(jsonOf(secondUse)["error"]).toMatchObject({ code: "RefreshTokenReused" })
  })

  it("rejects every older token of the chain once it has been replaced", async () => {
    const { refreshToken: first } = await registerUser(harness, "pat@example.com")
    const second = requiredCookie(await refresh(first), "prism_refresh")

    expect((await refresh(second)).statusCode).toBe(200)
    expect((await refresh(first)).statusCode).toBe(401)
    expect((await refresh(second)).statusCode).toBe(401)
  })
})
