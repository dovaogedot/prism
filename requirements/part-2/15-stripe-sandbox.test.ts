/**
 * REQUIREMENTS_2.md: "The payment system integrates with Stripe, PayPal or
 * other similar simulation sandbox APIs."
 *
 * Stripe's test mode needs an account's keys, so the API runs against a
 * stand-in for Stripe that signs its webhooks with Stripe's own library, and
 * the shop's Stripe client is checked on events signed the same way.
 */

import { randomUUID } from "node:crypto"
import Stripe from "stripe"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PaymentGateway } from "../../apps/api/src/platform/payment-gateway.ts"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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

describe("an order", () => {
  it("creates a payment intent at the provider for the amount the server priced, and hands its client secret to the browser", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])
    const response = await Shop.place(harness, guest)
    const charge = await Shop.chargeOf(harness, String(jsonOf(response)["orderId"]))

    expect(response.statusCode).toBe(201)
    // 2,500 for the lamp and 490 for standard shipping, below the free shipping threshold.
    expect(harness.gateway.calls.createIntent).toEqual([{ paymentId: charge.id, amountCents: 2990 }])
    expect(jsonOf(response)["clientSecret"]).toBe(`${charge.intent}_secret_fake`)
  })

  it("is paid when the provider's signed webhook says so", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

    expect((await Shop.succeed(harness, placed.charge)).statusCode).toBe(200)
    await harness.settle()

    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))).toMatchObject({
      status: "payment_successful",
      payment: { status: "succeeded", reference: placed.charge.intent, card: { brand: "visa", last4: "4242" } },
    })
  })

  it("stays as it is when a webhook carries no valid signature", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))
    const { payload } = harness.gateway.sign({ type: "payment_intent.succeeded", object: Shop.intent(placed.charge) })
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_not_the_shops" })

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": forged },
      payload,
    })
    await harness.settle()

    expect(response.statusCode).toBe(400)
    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))).toMatchObject({
      status: "pending_payment",
    })
  })
})

describe("the shop's Stripe client", () => {
  const WEBHOOK_SECRET = "whsec_requirements_check"
  const stripe = PaymentGateway.stripe({
    secretKey: "sk_test_requirements_check",
    webhookSecret: { from: "value", value: WEBHOOK_SECRET },
    timeoutMs: 1000,
  })

  /** A `payment_intent.succeeded` event as Stripe sends it about the payment row `paymentId`. */
  const succeeded = (paymentId: string): string =>
    JSON.stringify({
      id: "evt_requirements",
      object: "event",
      api_version: Stripe.API_VERSION,
      created: Math.floor(Date.now() / 1000),
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_requirements",
          object: "payment_intent",
          amount: 2990,
          amount_received: 2990,
          currency: "eur",
          status: "succeeded",
          // Expanded, so reading the card asks Stripe nothing.
          payment_method: { id: "pm_requirements", object: "payment_method", card: { brand: "visa", last4: "4242" } },
          metadata: { [PaymentGateway.PAYMENT_KEY]: paymentId },
        },
      },
    })

  it("reads an event Stripe signed with the shop's webhook secret", async () => {
    const paymentId = randomUUID()
    const payload = succeeded(paymentId)
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })

    const event = await stripe.parseWebhook(Buffer.from(payload), signature)

    expect(event.isOk() ? event.value : event.error).toEqual({
      _tag: "ChargeSucceeded",
      paymentId,
      reference: "pi_requirements",
      amountCents: 2990,
      card: { brand: "visa", last4: "4242" },
    })
  })

  it("refuses an event signed with another secret", async () => {
    const payload = succeeded(randomUUID())
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" })

    const event = await stripe.parseWebhook(Buffer.from(payload), signature)

    expect(event.isErr() ? event.error : event.value).toEqual({ _tag: "WebhookSignatureInvalid" })
  })
})
