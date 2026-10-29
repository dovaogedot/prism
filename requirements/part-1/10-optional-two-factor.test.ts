/**
 * REQUIREMENTS_1.md: "Two-factor authentication (2FA) is available as an
 * optional, user-enabled feature."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { cookieValue, jsonOf, registerUser, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"

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

const callAs = (accessToken: string, url: string, payload: object = {}) =>
  harness.app.inject({ method: "POST", url: `/api/v1${url}`, headers: { authorization: `Bearer ${accessToken}` }, payload })

const sendCode = (challengeToken: unknown, code: string) =>
  harness.app.inject({ method: "POST", url: "/api/v1/auth/login/2fa", payload: { challengeToken, code } })

/** Turns 2FA on the way the account page does: enroll a secret, then confirm it with a code and the password. Resolves to the secret. */
const turnOnTwoFactor = async (accessToken: string): Promise<string> => {
  const setup = await callAs(accessToken, "/auth/2fa/setup")
  const secret = new URL(String(jsonOf(setup)["uri"])).searchParams.get("secret")
  if (secret === null) {
    throw new Error(`The setup handed out no secret: ${setup.body}`)
  }

  const enabled = await callAs(accessToken, "/auth/2fa/enable", { code: harness.totpCodeFor(secret), currentPassword: VALID_PASSWORD })
  expect(enabled.statusCode).toBe(200)
  expect(jsonOf(enabled)).toMatchObject({ twoFactorEnabled: true })

  return secret
}

describe("two-factor authentication", () => {
  it("is off for a new account, which signs in with its password alone", async () => {
    const { response } = await registerUser(harness, "pat@example.com")
    const signedIn = await signIn("pat@example.com")

    expect(jsonOf(response)["user"]).toMatchObject({ twoFactorEnabled: false })
    expect(jsonOf(signedIn)).toMatchObject({ status: "authenticated" })
  })

  it("once its owner turns it on, asks for a code after the password and signs in only with a right one", async () => {
    const { accessToken } = await registerUser(harness, "pat@example.com")
    const secret = await turnOnTwoFactor(accessToken)
    // A code works once, so the sign-in below waits for the next one.
    harness.clock.advanceSeconds(30)

    const password = await signIn("pat@example.com")
    const challengeToken = jsonOf(password)["challengeToken"]
    const wrongCode = await sendCode(challengeToken, "000000")
    const rightCode = await sendCode(challengeToken, harness.totpCodeFor(secret))

    expect(jsonOf(password)).toMatchObject({ status: "two_factor_required" })
    expect(cookieValue(password, "prism_refresh")).toBeUndefined()
    expect(wrongCode.statusCode).toBe(401)
    expect(jsonOf(rightCode)).toMatchObject({ status: "authenticated", grant: { user: { email: "pat@example.com" } } })
  })

  it("stays a choice of each account: turning it on for one leaves another signing in without a code", async () => {
    await turnOnTwoFactor((await registerUser(harness, "pat@example.com")).accessToken)
    await registerUser(harness, "kim@example.com")

    expect(jsonOf(await signIn("pat@example.com"))).toMatchObject({ status: "two_factor_required" })
    expect(jsonOf(await signIn("kim@example.com"))).toMatchObject({ status: "authenticated" })
  })

  it("can be turned off again by its owner with a code, which brings back the password-only sign-in", async () => {
    const { accessToken } = await registerUser(harness, "pat@example.com")
    const secret = await turnOnTwoFactor(accessToken)
    harness.clock.advanceSeconds(30)

    const disabled = await callAs(accessToken, "/auth/2fa/disable", { code: harness.totpCodeFor(secret) })

    expect(disabled.statusCode).toBe(200)
    expect(jsonOf(await signIn("pat@example.com"))).toMatchObject({ status: "authenticated" })
  })
})
