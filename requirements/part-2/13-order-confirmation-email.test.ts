/**
 * REQUIREMENTS_2.md: "The system sends an email confirmation to the user
 * after a successful order placement."
 *
 * An order is successful once its payment goes through, which Stripe tells
 * the shop with a signed webhook.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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

describe("a paid order", () => {
  it("is confirmed by email to the address given at checkout, with its items, total and a link to it", async () => {
    const guest = await Shop.fill(harness, [
      ["desk-lamp", 2],
      ["oak-chair", 1],
    ])
    const placed = await Shop.placed(harness, guest)

    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect(harness.mailer.sent).toHaveLength(1)
    const [email] = harness.mailer.sent

    expect(email).toMatchObject({ to: "mari@example.com", subject: `Order #${placed.number} confirmed` })
    expect(email?.text).toContain("Hi Mari Maasikas, we received your payment and your order is confirmed.")
    expect(email?.text).toContain("2 × Desk Lamp  €50.00")
    expect(email?.text).toContain("1 × Oak Chair  €120.00")
    expect(email?.text).toContain("Total     €170.00")
    expect(email?.text).toContain(`/orders/${placed.orderId}?key=${placed.key}`)
    expect(email?.html).toContain("Thank you for your order")
  })

  it("is confirmed to a signed-in customer too, with a link that needs no key", async () => {
    const { accessToken } = await registerUser(harness, "member@example.com")
    const me = await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken })
    const placed = await Shop.placed(harness, me)

    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect(harness.mailer.sent.map((email) => [email.to, email.subject])).toEqual([
      ["mari@example.com", `Order #${placed.number} confirmed`],
    ])
    expect(harness.mailer.sent[0]?.text).toMatch(new RegExp(`/orders/${placed.orderId}$`, "m"))
  })

  it("is confirmed once, however many times the provider repeats its webhook", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

    await Shop.succeed(harness, placed.charge)
    await Shop.succeed(harness, placed.charge)
    await harness.settle()
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect(harness.mailer.sent.map((email) => email.subject)).toEqual([`Order #${placed.number} confirmed`])
  })
})
