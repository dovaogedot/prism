/**
 * REQUIREMENTS_3.md: "The system enforces 2FA for all admin accounts."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { jsonOf, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"
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

const signIn = (email: string) =>
  harness.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: VALID_PASSWORD } })

describe("an admin account", () => {
  it("opens no admin route until it has set up 2FA", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"], { hasTwoFactor: false })

    for (const url of ["/admin/summary", "/admin/users", "/admin/orders", "/admin/products"]) {
      const response = await Staff.call(harness, admin, "GET", url)

      expect(response.statusCode, url).toBe(403)
      expect(jsonOf(response)["error"], url).toMatchObject({ code: "TwoFactorSetupRequired" })
    }
  })

  it("signs in with a password only as far as the code check, and reaches the admin once the code is given", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"])

    if (admin.secret === undefined) {
      throw new Error("the admin has no 2FA secret")
    }

    const password = await signIn("admin@example.com")
    expect(jsonOf(password)).toMatchObject({ status: "two_factor_required", challengeToken: expect.any(String) })
    expect(jsonOf(password)).not.toHaveProperty("grant")

    Staff.nextCode(harness)
    const wrong = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login/2fa",
      payload: { challengeToken: jsonOf(password)["challengeToken"], code: "000000" },
    })
    const right = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login/2fa",
      payload: { challengeToken: jsonOf(password)["challengeToken"], code: harness.totpCodeFor(admin.secret) },
    })
    const grant = jsonOf(right)["grant"] as { accessToken: string }

    expect(wrong.statusCode).toBe(401)
    expect((await Staff.call(harness, { ...admin, accessToken: grant.accessToken }, "GET", "/admin/users")).statusCode).toBe(200)
  })

  it("asks a session for a code again once its last check is 8 hours old", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"])
    expect((await Staff.call(harness, admin, "GET", "/admin/users")).statusCode).toBe(200)

    harness.clock.advanceSeconds(8 * 60 * 60)
    const refreshed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: admin.refreshToken },
    })
    const response = await Staff.call(harness, { ...admin, accessToken: String(jsonOf(refreshed)["accessToken"]) }, "GET", "/admin/users")

    expect(response.statusCode).toBe(403)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "TwoFactorVerificationRequired" })
  })

  it("loses the admin role when it turns 2FA off, so no admin is ever without it", async () => {
    await Staff.account(harness, "other-admin@example.com", ["admin"])
    const admin = await Staff.account(harness, "admin@example.com", ["admin"])

    if (admin.secret === undefined) {
      throw new Error("the admin has no 2FA secret")
    }

    Staff.nextCode(harness)
    await Staff.call(harness, admin, "POST", "/auth/2fa/disable", { code: harness.totpCodeFor(admin.secret) })

    expect((await Staff.call(harness, admin, "GET", "/admin/users")).statusCode).toBe(403)
    expect(
      await harness.database.sql`SELECT count(*)::int AS n FROM app_user WHERE 'admin' = ANY(roles) AND totp_enabled_at IS NULL`,
    ).toEqual([{ n: 0 }])
  })
})
