/**
 * REQUIREMENTS_2.md: "The checkout process handles and displays appropriate
 * error messages for invalid inputs or failed transactions."
 *
 * Its note: "Verify specific error messages for: missing required fields,
 * invalid formats (email, phone, address), payment validation, and network
 * errors."
 *
 * The field and payment messages are the API's, which the checkout shows
 * under each field and beside "Place order". The messages for Stripe's own
 * answers and for a request that got no answer are the storefront's, made by
 * its own functions.
 */

import { fileURLToPath } from "node:url"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Api, NetworkError } from "../../apps/web/src/shared/api/client.ts"

/** A storefront module loaded by path, so this folder's typecheck leaves it to the storefront's own. */
const webModule = (path: string): Promise<unknown> => import(fileURLToPath(new URL(`../../apps/web/src/${path}`, import.meta.url)))

// The checkout module imports Stripe.js by an entry point this folder's module resolution does not find.
const { PaymentErrors } = (await webModule("features/checkout/checkout.ts")) as {
  PaymentErrors: { messageOf: (error: Readonly<{ type: string; code?: string; decline_code?: string; message?: string }>) => string }
}
// The failure module draws JSX, which this folder's typecheck does not compile.
const { Failure } = (await webModule("shared/api/failure.tsx")) as { Failure: { message: (reason: unknown) => string } }

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

/** The field issues a refused order answers, as path and message. */
const issuesOf = (response: { body: string }) =>
  ((jsonOf(response)["error"] as { issues: { path: string; message: string }[] }).issues ?? []).map((issue) => [issue.path, issue.message])

const placeWith = async (overrides: Readonly<Record<string, unknown>>) =>
  Shop.place(harness, await Shop.fill(harness, [["desk-lamp", 1]]), overrides)

describe("missing required fields", () => {
  it("each get a message of their own", async () => {
    const response = await placeWith({
      contact: { fullName: "", email: "", phone: "" },
      address: { line1: "", city: "", postalCode: "", country: "EE" },
      shippingMethod: "",
    })

    expect(response.statusCode).toBe(422)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ValidationFailed", message: "Please check the highlighted fields." })
    expect(issuesOf(response)).toEqual(
      expect.arrayContaining([
        ["contact.fullName", "Enter your full name."],
        ["contact.email", "Enter a valid email address."],
        ["contact.phone", "Enter a phone number."],
        ["address.line1", "Enter the street and house number."],
        ["address.city", "Enter the city."],
        ["address.postalCode", "Enter the postal code."],
        ["shippingMethod", "Choose a shipping method."],
      ]),
    )
  })
})

describe("invalid formats", () => {
  it.each([
    [
      "an email",
      { contact: { fullName: "Mari Maasikas", email: "mari@", phone: "+372 5123 4567" } },
      "contact.email",
      "Enter a valid email address.",
    ],
    [
      "a phone number",
      { contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "12" } },
      "contact.phone",
      "Enter a phone number like +372 5123 4567.",
    ],
    [
      "a postal code",
      { address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "ABC", country: "EE" } },
      "address.postalCode",
      "Enter a postal code like 10111.",
    ],
    [
      "a country",
      { address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "US" } },
      "address.country",
      "Choose a country.",
    ],
  ] as const)("of %s get a message that says what is expected", async (_field, overrides, path, message) => {
    const response = await placeWith(overrides)

    expect(response.statusCode).toBe(422)
    expect(issuesOf(response)).toEqual([[path, message]])
  })

  it("include an address the lookup cannot find", async () => {
    harness.addressVerifier.answer("not_found")
    const response = await placeWith({})

    expect(response.statusCode).toBe(422)
    expect(issuesOf(response)).toEqual([["address.line1", "We could not find this address. Check the street, postal code and city."]])
  })
})

describe("payment validation", () => {
  it("says so when the total shown is no longer what the cart costs, and charges nothing", async () => {
    const response = await placeWith({ expectedTotalCents: 1 })

    expect(response.statusCode).toBe(409)
    expect(jsonOf(response)["error"]).toMatchObject({
      code: "CartChanged",
      message: "Prices or stock changed. Check the summary and place the order again.",
    })
    expect(harness.gateway.calls.createIntent).toEqual([])
  })

  it("says why a declined card failed, on the order the checkout opens", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

    await Shop.decline(harness, placed.charge, "card_declined", "insufficient_funds")
    await harness.settle()

    const order = jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))
    expect(order).toMatchObject({ status: "payment_failed", payment: { status: "failed", failure: "insufficient_funds" } })
    expect(order["events"]).toContainEqual(
      expect.objectContaining({ status: "payment_failed", note: "Your card has insufficient funds. Try another card." }),
    )
  })

  it("shows Stripe's own message for a card field it refused, and the shop's for a decline", () => {
    expect(
      PaymentErrors.messageOf({
        type: "validation_error",
        code: "invalid_expiry_year_past",
        message: "Your card's expiration year is in the past.",
      }),
    ).toBe("Your card's expiration year is in the past.")
    expect(PaymentErrors.messageOf({ type: "card_error", code: "incorrect_cvc" })).toBe("The security code (CVC) is incorrect.")
    expect(PaymentErrors.messageOf({ type: "card_error", code: "expired_card" })).toBe(
      "Your card has expired. Check the expiry date or use another card.",
    )
  })

  it("says the provider did not answer, and that nothing was charged", async () => {
    harness.gateway.failNext("createIntent", "gateway_timeout")
    const response = await placeWith({})

    expect(response.statusCode).toBe(504)
    expect(jsonOf(response)["error"]).toMatchObject({
      code: "PaymentGatewayUnavailable",
      message: "The payment provider did not answer. You have not been charged.",
    })
  })
})

describe("network errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("say the server could not be reached when a request gets no answer", async () => {
    // What fetch does when the browser is offline or the connection is refused.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch")
    })

    const reason: unknown = await Api.post("/orders", {}).catch((caught: unknown) => caught)

    expect(reason).toBeInstanceOf(NetworkError)
    expect(Failure.message(reason)).toBe("We could not reach the server. Try again.")
  })

  it("say Stripe could not be reached, and that nothing was charged", () => {
    expect(PaymentErrors.messageOf({ type: "api_connection_error" })).toBe(
      "We could not reach the payment provider. Check your connection and try again. You have not been charged.",
    )
  })
})
