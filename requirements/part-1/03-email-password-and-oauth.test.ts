/**
 * REQUIREMENTS_1.md: "The system implements both email-password and OAuth
 * authentication methods."
 *
 * OAuth runs through the stand-in provider the API serves on localhost,
 * which walks the same redirect, state check and code exchange as Google
 * and GitHub.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, requiredCookie, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

const post = (url: string, payload: object) => harness.app.inject({ method: "POST", url: `/api/v1${url}`, payload })

describe("email and password", () => {
  it("registers an account and signs it in again", async () => {
    const registered = await post("/auth/register", { email: "pat@example.com", password: VALID_PASSWORD, captchaToken: "test-token" })
    const signedIn = await post("/auth/login", { email: "pat@example.com", password: VALID_PASSWORD })

    expect(registered.statusCode).toBe(201)
    expect(jsonOf(signedIn)).toMatchObject({ status: "authenticated", grant: { user: { email: "pat@example.com" } } })
  })

  it("refuses a wrong password", async () => {
    await post("/auth/register", { email: "kim@example.com", password: VALID_PASSWORD, captchaToken: "test-token" })

    expect((await post("/auth/login", { email: "kim@example.com", password: "not the right one at all" })).statusCode).toBe(401)
  })
})

describe("OAuth", () => {
  it("signs a person in through a provider's consent screen and callback", async () => {
    const begin = await harness.app.inject({ method: "GET", url: "/api/v1/auth/oauth/google" })
    const state = requiredCookie(begin, "prism_oauth_state")

    // The provider's screen, where the person picks the account to sign in with.
    const consent = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/google/consent",
      payload: { email: "lee@example.com", state },
    })
    const callback = await harness.app.inject({
      method: "GET",
      url: new URL(String(consent.headers["location"])).pathname + new URL(String(consent.headers["location"])).search,
      cookies: { prism_oauth_state: state },
    })
    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: requiredCookie(callback, "prism_refresh") },
    })

    expect(String(begin.headers["location"])).toContain("/oauth/google/consent")
    expect(String(callback.headers["location"])).toContain("/oauth/complete")
    expect(jsonOf(grant)["user"]).toMatchObject({ email: "lee@example.com", providers: ["google"] })
  })
})
