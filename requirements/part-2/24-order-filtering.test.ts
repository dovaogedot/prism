/**
 * REQUIREMENTS_2.md: "The order filtering system allows users to sort by
 * date and order status."
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

const DAY_SECONDS = 24 * 60 * 60

/** A fresh session for the buyer: an access token lasts minutes, and the orders are days apart. */
const signIn = async (): Promise<string> => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "buyer@example.com", password: VALID_PASSWORD },
  })
  return (jsonOf(response)["grant"] as { accessToken: string }).accessToken
}

/** The buyer's order numbers as `GET /orders` lists them with `query`, each with its status and day. */
const listed = async (query: string) => {
  const response = await Shop.call(harness, "GET", `/orders${query}`, { token: await signIn() })
  if (response.statusCode !== 200) throw new Error(`Listing failed: ${response.body}`)

  return (jsonOf(response) as unknown as { items: { number: number; status: string; createdAt: string }[] }).items.map((item) => [
    item.number,
    item.status,
  ])
}

let days: string[] = []

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 }])
  await registerUser(harness, "buyer@example.com")
  days = []

  // Three orders a day apart: paid, then failed, then waiting for its payment.
  for (const outcome of ["paid", "failed", "pending"] as const) {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: await signIn() }))
    days.push(harness.clock.now().toISOString().slice(0, 10))

    if (outcome === "paid") await Shop.succeed(harness, placed.charge)
    if (outcome === "failed") await Shop.decline(harness, placed.charge, "card_declined", "insufficient_funds")
    await harness.settle()
    harness.clock.advanceSeconds(DAY_SECONDS)
  }

  // Someone else's order, which the buyer never sees.
  const other = await registerUser(harness, "other@example.com")
  await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: other.accessToken }))
})

describe("sorting", () => {
  it("puts the newest first by default, and the oldest first when asked", async () => {
    expect(await listed("")).toEqual([
      [100003, "pending_payment"],
      [100002, "payment_failed"],
      [100001, "payment_successful"],
    ])
    expect(await listed("?sort=newest")).toEqual(await listed(""))
    expect(await listed("?sort=oldest")).toEqual([
      [100001, "payment_successful"],
      [100002, "payment_failed"],
      [100003, "pending_payment"],
    ])
  })

  it("orders by status in the order an order lives through them", async () => {
    expect(await listed("?sort=status")).toEqual([
      [100003, "pending_payment"],
      [100001, "payment_successful"],
      [100002, "payment_failed"],
    ])
  })
})

describe("filtering", () => {
  it("narrows to one status or several", async () => {
    expect(await listed("?status=payment_failed")).toEqual([[100002, "payment_failed"]])
    expect(await listed("?status=payment_successful&status=pending_payment")).toEqual([
      [100003, "pending_payment"],
      [100001, "payment_successful"],
    ])
  })

  it("narrows to a date range whose ends both count", async () => {
    const [first, second, third] = days

    expect(await listed(`?from=${second}&to=${second}`)).toEqual([[100002, "payment_failed"]])
    expect(await listed(`?from=${second}`)).toEqual([
      [100003, "pending_payment"],
      [100002, "payment_failed"],
    ])
    expect(await listed(`?to=${second}`)).toEqual([
      [100002, "payment_failed"],
      [100001, "payment_successful"],
    ])
    expect(await listed(`?from=${first}&to=${third}&status=payment_successful&sort=oldest`)).toEqual([[100001, "payment_successful"]])
  })

  it("refuses a status that does not exist and a range that ends before it starts", async () => {
    const token = await signIn()

    expect((await Shop.call(harness, "GET", "/orders?status=lost", { token })).statusCode).toBe(422)
    expect((await Shop.call(harness, "GET", `/orders?from=${days[2]}&to=${days[0]}`, { token })).statusCode).toBe(422)
  })
})
