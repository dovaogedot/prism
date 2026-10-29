/**
 * REQUIREMENTS_2.md: "The payment form uses the payment provider's secure
 * form elements instead of handling card details directly."
 *
 * Stripe's fields only load with a Stripe account's keys, so the storefront
 * is checked in its source, and the API through its HTTP surface.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (path: string): string => readFileSync(join(root, path), "utf8")

/** Every file under `directory`, as paths from the repository root. */
const filesUnder = (directory: string): readonly string[] =>
  readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length))

describe("the storefront", () => {
  it("depends on Stripe's React components and Stripe.js", () => {
    const { dependencies } = JSON.parse(read("apps/web/package.json")) as { dependencies: Record<string, string> }

    expect(Object.keys(dependencies)).toEqual(expect.arrayContaining(["@stripe/react-stripe-js", "@stripe/stripe-js"]))
  })

  it("draws the payment section with Stripe's Payment Element, inside Stripe's Elements", () => {
    const page = read("apps/web/src/features/checkout/pages/CheckoutPage.tsx")
    const fields = read("apps/web/src/features/checkout/components/PaymentFields.tsx")

    expect(page).toMatch(/import \{ Elements \} from "@stripe\/react-stripe-js"/)
    expect(page).toMatch(/<Elements\s/)
    expect(fields).toMatch(/import \{ PaymentElement \} from "@stripe\/react-stripe-js"/)
    expect(fields).toMatch(/<PaymentElement\s/)
  })

  it("has Stripe check and confirm the card, never reading it itself", () => {
    const body = read("apps/web/src/features/checkout/components/CheckoutBody.tsx")

    expect(body).toMatch(/payments\.elements\.submit\(\)/)
    expect(body).toMatch(/payments\.stripe\s*\.confirmPayment\(\{\s*elements: payments\.elements,/)
  })

  it("renders no card number, expiry or security code field of its own", () => {
    // An attribute whose quoted value names a card part, such as label="Card number" or autoComplete="cc-exp".
    const cardField = /\b(label|placeholder|aria-label|autoComplete|name|id)=\{?["'`][^"'`]*(card|cvc|cvv|expir|security code|cc-)/i
    const cardRegistration = /register\(\s*["'`][^"'`]*(card|cvc|cvv|expir)/i
    const offending = filesUnder("apps/web/src")
      .filter((path) => path.endsWith(".tsx") || path.endsWith(".ts"))
      .flatMap((path) =>
        read(path)
          .split("\n")
          .filter((line) => cardField.test(line) || cardRegistration.test(line))
          .map((line) => `${path}: ${line.trim()}`),
      )

    expect(offending).toEqual([])
  })

  it("lets the browser load Stripe's script and card frames, and talk to Stripe's API", () => {
    const policy = /Content-Security-Policy "([^"]+)"/.exec(read("apps/web/Caddyfile"))?.[1] ?? ""
    const directive = (name: string) => policy.split(";").find((part) => part.trim().startsWith(`${name} `)) ?? ""

    expect(directive("script-src")).toContain("https://js.stripe.com")
    expect(directive("frame-src")).toContain("https://js.stripe.com")
    expect(directive("connect-src")).toContain("https://api.stripe.com")
  })
})

describe("the API", () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness()
    await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }])
  }, 180_000)

  afterAll(async () => {
    await harness.stop()
  })

  it("refuses an order that carries card details, and creates neither an order nor a charge", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])

    for (const card of [
      { cardNumber: "4242424242424242" },
      { card: { number: "4242424242424242", expiry: "12/34", cvc: "123" } },
      { cvc: "123" },
    ]) {
      const response = await Shop.place(harness, guest, card)

      expect(response.statusCode, JSON.stringify(card)).toBe(422)
      expect(jsonOf(response)["error"]).toMatchObject({ code: "ValidationFailed" })
    }
    expect(await harness.database.sql`SELECT id FROM customer_order`).toEqual([])
    expect(harness.gateway.calls.createIntent).toEqual([])
  })

  it("answers an order with a client secret, which the browser hands to Stripe with the card", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])
    const response = await Shop.place(harness, guest)

    expect(response.statusCode).toBe(201)
    expect(jsonOf(response)["clientSecret"]).toMatch(/^pi_fake_\d+_secret_fake$/)
  })
})
