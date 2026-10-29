/**
 * REQUIREMENTS_1.md: "Token revocation mechanism is in place for both access
 * and refresh tokens."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  jsonOf,
  registerUser,
  requiredCookie,
  startHarness,
  userIdOf,
  VALID_PASSWORD,
  type Harness,
} from "../../apps/api/tests/support/harness.ts"
import { Staff } from "../../apps/api/tests/support/staff.ts"

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

const getMe = (accessToken: string) =>
  harness.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${accessToken}` } })

const refresh = (refreshToken: string) =>
  harness.app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { prism_refresh: refreshToken } })

describe("signing out", () => {
  it("revokes the session's access token at once, long before it expires, and its refresh token", async () => {
    const { accessToken, refreshToken } = await registerUser(harness, "pat@example.com")
    expect((await getMe(accessToken)).statusCode).toBe(200)

    const signOut = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const afterwards = await getMe(accessToken)

    expect(signOut.statusCode).toBe(204)
    expect(afterwards.statusCode).toBe(401)
    expect(jsonOf(afterwards)["error"]).toMatchObject({ code: "SessionRevoked" })
    expect((await refresh(refreshToken)).statusCode).toBe(401)
  })
})

describe("an admin signing an account out everywhere", () => {
  it("revokes the access and refresh tokens of every session the account holds", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"])
    const laptop = await registerUser(harness, "pat@example.com")
    const signedIn = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "pat@example.com", password: VALID_PASSWORD },
    })
    const phone = {
      accessToken: String((jsonOf(signedIn)["grant"] as Record<string, unknown>)["accessToken"]),
      refreshToken: requiredCookie(signedIn, "prism_refresh"),
    }
    const userId = await userIdOf(harness, "pat@example.com")

    const response = await Staff.call(harness, admin, "POST", `/admin/users/${String(userId)}/sign-out`)

    expect(response.statusCode).toBe(200)

    for (const session of [laptop, phone]) {
      expect((await getMe(session.accessToken)).statusCode).toBe(401)
      expect((await refresh(session.refreshToken)).statusCode).toBe(401)
    }

    // The admin's own session stays open.
    expect((await getMe(admin.accessToken)).statusCode).toBe(200)
  })
})
