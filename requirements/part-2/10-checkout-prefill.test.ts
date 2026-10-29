/**
 * REQUIREMENTS_2.md: "For logged-in users, known information is pre-filled
 * in the checkout form."
 *
 * The API answers what it knows, and the storefront's own function turns that
 * answer into the values the checkout form starts with.
 */

import { fileURLToPath } from "node:url"
import type { CheckoutForm, CheckoutPrefill, ShippingOption } from "@prism/shared"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop, type Caller } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

/**
 * The storefront's checkout module, loaded by path: it imports Stripe.js by an
 * entry point that this folder's module resolution does not find.
 */
const { CheckoutDefaults } = (await import(
  fileURLToPath(new URL("../../apps/web/src/features/checkout/checkout.ts", import.meta.url))
)) as {
  CheckoutDefaults: { fromPrefill: (prefill: CheckoutPrefill, options: readonly [ShippingOption, ...ShippingOption[]]) => CheckoutForm }
}

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 }])
})

/** The form a signed-in customer's checkout starts with, from what the API answers. */
const formOf = async (caller: Caller) => {
  const prefill = await Shop.call(harness, "GET", "/checkout/prefill", caller)
  if (prefill.statusCode !== 200) throw new Error(`The prefill was refused: ${prefill.body}`)

  const [first, ...rest] = (jsonOf(await Shop.call(harness, "GET", "/shipping-methods")) as unknown as { items: ShippingOption[] }).items
  if (first === undefined) throw new Error("No delivery option is offered.")

  return CheckoutDefaults.fromPrefill(JSON.parse(prefill.body) as CheckoutPrefill, [first, ...rest])
}

describe("a signed-in customer's checkout form", () => {
  it("starts with the account's email before anything else is known", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")

    expect(await formOf({ token: accessToken })).toMatchObject({
      contact: { fullName: "", email: "buyer@example.com", phone: "" },
      address: { line1: "", city: "", postalCode: "" },
    })
  })

  it("starts with the profile's name and phone and the default saved address", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const me = { token: accessToken }

    await Shop.call(harness, "PUT", "/account/profile", me, { fullName: "Mari Maasikas", phone: "+372 5123 4567" })
    await Shop.call(harness, "POST", "/account/addresses", me, {
      label: "Home",
      fullName: "Mari Maasikas",
      phone: "+372 5123 4567",
      address: { line1: "Pikk 1", city: "Tartu", postalCode: "51003", country: "EE" },
      isDefault: true,
    })

    expect(await formOf(me)).toEqual({
      contact: { fullName: "Mari Maasikas", email: "buyer@example.com", phone: "+37251234567" },
      address: { line1: "Pikk 1", line2: "", city: "Tartu", postalCode: "51003", country: "EE" },
      shippingMethod: "standard",
    })
  })

  it("starts with the last order's contact, address and delivery option", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const me = await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken })
    const placed = await Shop.place(harness, me, {
      contact: { fullName: "Kaur Kask", email: "kaur@example.com", phone: "+372 5555 0101" },
      address: { line1: "Riia 12", line2: "Apartment 3", city: "Tartu", postalCode: "51010", country: "EE" },
      shippingMethod: "express",
      expectedTotalCents: await Shop.totalOf(harness, me, "express"),
    })
    expect(placed.statusCode).toBe(201)

    expect(await formOf(me)).toEqual({
      contact: { fullName: "Kaur Kask", email: "kaur@example.com", phone: "+37255550101" },
      address: { line1: "Riia 12", line2: "Apartment 3", city: "Tartu", postalCode: "51010", country: "EE" },
      shippingMethod: "express",
    })
  })
})

describe("a guest", () => {
  it("gets nothing pre-filled", async () => {
    expect((await Shop.call(harness, "GET", "/checkout/prefill")).statusCode).toBe(401)
  })
})
