/**
 * REQUIREMENTS_2.md: "A persistent cart is implemented for logged-in users,
 * retaining items across sessions."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 10 },
  ])
})

/** Opens a new session for `email`, as signing in on any device does. Resolves to its access token. */
const signIn = async (email: string): Promise<string> => {
  const response = await harness.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: VALID_PASSWORD } })
  const grant = jsonOf(response)["grant"] as { accessToken?: string } | undefined
  if (grant?.accessToken === undefined) throw new Error(`Signing in ${email} failed: ${response.body}`)

  return grant.accessToken
}

const signOut = (token: string) =>
  harness.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { authorization: `Bearer ${token}` } })

const linesOf = async (token: string) =>
  (JSON.parse((await Shop.call(harness, "GET", "/cart", { token })).body) as { lines: { slug: string; quantity: number }[] }).lines.map(
    (line) => [line.slug, line.quantity],
  )

describe("a signed-in customer's cart", () => {
  it("is there again after signing out and back in", async () => {
    const { accessToken } = await registerUser(harness, "member@example.com")
    await Shop.fill(
      harness,
      [
        ["desk-lamp", 2],
        ["oak-chair", 1],
      ],
      { token: accessToken },
    )

    expect((await signOut(accessToken)).statusCode).toBe(204)
    const again = await signIn("member@example.com")

    expect(await linesOf(again)).toEqual([
      ["desk-lamp", 2],
      ["oak-chair", 1],
    ])
  })

  it("is the same cart in every session of the account, such as on another device", async () => {
    const { accessToken: laptop } = await registerUser(harness, "member@example.com")
    const phone = await signIn("member@example.com")

    await Shop.fill(harness, [["desk-lamp", 1]], { token: laptop })
    await Shop.fill(harness, [["oak-chair", 3]], { token: phone })

    expect(await linesOf(laptop)).toEqual([
      ["desk-lamp", 1],
      ["oak-chair", 3],
    ])
    expect(await linesOf(phone)).toEqual(await linesOf(laptop))
  })

  it("outlives a guest cart's lifetime and the housekeeping that clears expired carts", async () => {
    const { accessToken } = await registerUser(harness, "member@example.com")
    await Shop.fill(harness, [["desk-lamp", 2]], { token: accessToken })

    harness.clock.advanceSeconds(harness.config.commerce.guestCartTtlSeconds * 2)
    await harness.jobs.housekeeping.run()

    expect(await linesOf(await signIn("member@example.com"))).toEqual([["desk-lamp", 2]])
  })
})
