/**
 * REQUIREMENTS_2.md: "All sensitive data stored in database is encrypted at
 * rest for order and payment data."
 *
 * Its note: "Check encryption implementation for: order details, shipping
 * addresses, and payment transaction records"
 *
 * An order's sensitive details are who it is for and how to reach them; what
 * was bought, the amounts and the status identify nobody and stay readable,
 * so the order lists can filter and sort on them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { CHECKOUT, Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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

const BILLING = { line1: "Rüütli 25", city: "Pärnu", postalCode: "80010", country: "EE" } as const

/** A column as the database holds it, as text a search can look through. */
const stored = (value: unknown): string => {
  if (!(value instanceof Uint8Array)) throw new Error(`Expected bytes, found ${typeof value}: ${String(value)}`)
  return Buffer.from(value).toString("latin1")
}

/** Expects none of `plaintexts` anywhere in `columns`, each of which holds bytes. */
const expectSealed = (columns: Readonly<Record<string, unknown>>, plaintexts: readonly string[]): void => {
  for (const [column, value] of Object.entries(columns)) {
    const bytes = stored(value)
    expect(bytes.length, column).toBeGreaterThan(16)

    for (const plaintext of plaintexts) {
      // The text's UTF-8 bytes, read the way `stored` reads the column.
      expect(bytes, `${column} holds "${plaintext}"`).not.toContain(Buffer.from(plaintext, "utf8").toString("latin1"))
    }
  }
}

/** A guest's paid order, shipped to the checkout address and billed to another. */
const paidOrder = async () => {
  const guest = await Shop.fill(harness, [["desk-lamp", 1]])
  const response = await Shop.place(harness, guest, { billingAddress: BILLING })
  if (response.statusCode !== 201) throw new Error(`Placing failed: ${response.body}`)
  const placed = jsonOf(response) as { orderId: string; key: string }
  const charge = await Shop.chargeOf(harness, placed.orderId)

  await Shop.succeed(harness, charge)
  await harness.settle()

  return { ...placed, charge }
}

describe("an order's details", () => {
  it("hold the contact, the shipping and billing addresses and the guest's key as ciphertext", async () => {
    const placed = await paidOrder()
    const [order] = await harness.database.sql`SELECT contact, shipping_address, billing_address, access_key FROM customer_order`

    expectSealed(order ?? {}, [
      "Mari",
      "Maasikas",
      "mari@example.com",
      "51234567",
      "Narva",
      "Tallinn",
      "10117",
      "Pärnu",
      "Rüütli",
      "80010",
      placed.key,
    ])
  })

  it("are served opened to the customer", async () => {
    const placed = await paidOrder()

    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))).toMatchObject({
      contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+37251234567" },
      address: CHECKOUT.address,
      billingAddress: BILLING,
    })
  })
})

describe("a payment transaction record", () => {
  it("holds the provider's payment id and the card as ciphertext", async () => {
    const placed = await paidOrder()
    const [payment] = await harness.database.sql`SELECT reference, details FROM payment WHERE kind = 'charge'`

    expectSealed(payment ?? {}, [placed.charge.intent, "pi_fake", "visa", "4242"])
  })

  it("holds a declined payment's reason as ciphertext", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))
    await Shop.decline(harness, placed.charge, "card_declined", "insufficient_funds")
    await harness.settle()

    const [payment] = await harness.database.sql`SELECT reference, details FROM payment WHERE kind = 'charge'`

    expectSealed(payment ?? {}, [placed.charge.intent, "insufficient_funds", "Your card was declined.", "0002"])
  })

  it("holds a refund's provider id as ciphertext", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken }))
    await Shop.succeed(harness, placed.charge)
    await harness.settle()
    await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken })
    await harness.settle()

    const [refund] = await harness.database.sql`SELECT reference FROM payment WHERE kind = 'refund'`

    expectSealed(refund ?? {}, ["re_fake"])
  })
})

describe("a saved shipping address", () => {
  it("is held as ciphertext", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const saved = await Shop.call(
      harness,
      "POST",
      "/account/addresses",
      { token: accessToken },
      { label: "Home", fullName: "Mari Maasikas", phone: "+372 5123 4567", address: CHECKOUT.address, isDefault: true },
    )
    expect(saved.statusCode).toBe(201)

    const [address] = await harness.database.sql`SELECT details FROM address`

    expectSealed(address ?? {}, ["Home", "Mari", "51234567", "Narva", "Tallinn", "10117"])
  })
})
