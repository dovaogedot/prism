/**
 * REQUIREMENTS_2.md: "The notification system sends appropriate emails for
 * both successful and failed payment scenarios."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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

const placedOrder = async () => Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 2]]))

describe("a successful payment", () => {
  it("sends the customer the order confirmation", async () => {
    const placed = await placedOrder()

    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect(harness.mailer.sent.map((email) => [email.to, email.subject])).toEqual([
      ["mari@example.com", `Order #${placed.number} confirmed`],
    ])
    expect(harness.mailer.sent[0]?.text).toContain("we received your payment and your order is confirmed")
  })
})

describe("a failed payment", () => {
  it.each([
    ["card_declined", "insufficient_funds", "Your card has insufficient funds. Try another card."],
    ["card_declined", "generic_decline", "Your card was declined. Try another card or contact your bank."],
    ["incorrect_cvc", undefined, "The security code (CVC) is incorrect."],
  ] as const)("sends the customer why it failed on %s/%s, and that nothing was charged", async (code, declineCode, reason) => {
    const placed = await placedOrder()

    await Shop.decline(harness, placed.charge, code, declineCode)
    await harness.settle()

    expect(harness.mailer.sent.map((email) => [email.to, email.subject])).toEqual([
      ["mari@example.com", `Payment for order #${placed.number} failed`],
    ])
    expect(harness.mailer.sent[0]?.text).toContain(reason)
    expect(harness.mailer.sent[0]?.text).toContain("You have not been charged.")
  })

  it("sends the same kind of email when the provider never answered", async () => {
    harness.gateway.failNext("createIntent", "gateway_timeout")

    expect((await Shop.place(harness, await Shop.fill(harness, [["desk-lamp", 1]]))).statusCode).toBe(504)
    await harness.settle()

    expect(harness.mailer.sent.map((email) => email.subject)).toEqual([expect.stringMatching(/^Payment for order #\d+ failed$/)])
    expect(harness.mailer.sent[0]?.text).toContain("The payment provider did not answer. You have not been charged.")
  })
})
