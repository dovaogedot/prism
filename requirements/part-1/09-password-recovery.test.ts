/**
 * REQUIREMENTS_1.md: "Password recovery and reset functionality via email is
 * implemented."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { jsonOf, registerUser, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"

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

const post = (url: string, payload: object) => harness.app.inject({ method: "POST", url: `/api/v1${url}`, payload })

const newPassword = "an entirely different passphrase"

/** The reset link of the one email sent, which has to be a link to the shop's reset page. */
const readEmailedLink = (): URL => {
  const link = /https:\/\/\S+/.exec(harness.mailer.sent[0]?.text ?? "")?.[0]
  if (link === undefined) {
    throw new Error(`The email carried no link: ${harness.mailer.sent[0]?.text ?? "no email was sent"}`)
  }

  return new URL(link)
}

describe("password recovery", () => {
  it("emails the account's owner a link to the reset page", async () => {
    await registerUser(harness, "pat@example.com")

    const response = await post("/auth/password/forgot", { email: "pat@example.com" })
    const link = readEmailedLink()

    expect(response.statusCode).toBe(204)
    expect(harness.mailer.sent.map((mail) => mail.to)).toEqual(["pat@example.com"])
    expect(link.origin + link.pathname).toBe("https://localhost:3000/reset-password")
    expect(link.searchParams.get("token")).toMatch(/.{20,}/)
  })

  it("sets the new password with the emailed token, after which only the new password signs in", async () => {
    await registerUser(harness, "pat@example.com")
    await post("/auth/password/forgot", { email: "pat@example.com" })

    const reset = await post("/auth/password/reset", { token: readEmailedLink().searchParams.get("token"), password: newPassword })
    const withOld = await post("/auth/login", { email: "pat@example.com", password: VALID_PASSWORD })
    const withNew = await post("/auth/login", { email: "pat@example.com", password: newPassword })

    expect(reset.statusCode).toBe(204)
    expect(withOld.statusCode).toBe(401)
    expect(jsonOf(withNew)).toMatchObject({ status: "authenticated" })
  })

  it("accepts the emailed token only once", async () => {
    await registerUser(harness, "pat@example.com")
    await post("/auth/password/forgot", { email: "pat@example.com" })
    const token = readEmailedLink().searchParams.get("token")

    const first = await post("/auth/password/reset", { token, password: newPassword })
    const second = await post("/auth/password/reset", { token, password: "yet another long passphrase" })

    expect(first.statusCode).toBe(204)
    expect(second.statusCode).toBe(400)
    expect(jsonOf(await post("/auth/login", { email: "pat@example.com", password: newPassword }))).toMatchObject({
      status: "authenticated",
    })
  })
})
