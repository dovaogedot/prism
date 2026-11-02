/**
 * REQUIREMENTS_2.md: "The checkout page collects basic information, address
 * input, and payment selection."
 *
 * The browser suite's stack simulates payments, so its payment section says
 * how the order is paid instead of drawing Stripe's card fields, which only
 * load with a Stripe account's keys; 16-provider-card-fields.test.ts checks
 * those.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./storefront.ts"

test("checkout has fields for the contact, the address, the delivery and the payment, and the order gets what was typed", async ({
  context,
  page,
}) => {
  const [product] = await Storefront.findProducts(context.request, 1, 10)
  if (product === undefined) throw new Error("No product to buy.")
  await Storefront.addToCart(context.request, product, 1)

  await Checks.open(page, "/checkout")

  const contact = page.getByRole("group", { name: "1. Contact" })
  for (const field of ["Full name", "Email", "Phone"]) {
    await expect(contact.getByRole("textbox", { name: field, exact: true })).toBeEditable()
  }

  const address = page.getByRole("group", { name: "2. Shipping address" })
  for (const field of ["Street and house number", "Apartment, floor (optional)", "City", "Postal code"]) {
    await expect(address.getByRole("textbox", { name: field, exact: true })).toBeEditable()
  }
  await expect(address.getByRole("combobox", { name: "Country" }).getByRole("option")).toHaveText([
    "Estonia",
    "Latvia",
    "Lithuania",
    "Finland",
    "Sweden",
    "Germany",
    "France",
    "Netherlands",
    "Poland",
  ])

  const delivery = page.getByRole("group", { name: "4. Delivery" })
  await expect(delivery.getByRole("radio")).toHaveCount((await Storefront.findDeliveryOptions(context.request)).length)

  const payment = page.getByRole("group", { name: "5. Payment" })
  await expect(payment.getByRole("alert")).toContainText("No card needed")

  await contact.getByRole("textbox", { name: "Full name" }).fill("Liis Ozola")
  await contact.getByRole("textbox", { name: "Email", exact: true }).fill("liis@example.com")
  await contact.getByRole("textbox", { name: "Phone" }).fill("+371 2000 0001")
  await address.getByRole("combobox", { name: "Country" }).selectOption({ label: "Latvia" })
  await address.getByRole("textbox", { name: "Street and house number" }).fill("Brivibas iela 21")
  await address.getByRole("textbox", { name: "Apartment, floor (optional)" }).fill("Apartment 4")
  await address.getByRole("textbox", { name: "City" }).fill("Riga")
  await address.getByRole("textbox", { name: "Postal code" }).fill("LV-1010")
  await delivery.getByRole("radio", { name: /^Express/ }).check()
  await page.getByRole("button", { name: "Place order" }).click()

  await expect(page.getByRole("alert").filter({ hasText: "Thank you, your order is confirmed" })).toBeVisible({ timeout: 30_000 })

  const shippingTo = page.getByRole("heading", { level: 2, name: "Shipping to" }).locator("..")
  await expect(shippingTo.locator("p")).toHaveText([
    "Liis Ozola",
    "Brivibas iela 21",
    "Apartment 4",
    "LV-1010 Riga",
    "Latvia",
    "liis@example.com",
    "+371 20000001",
  ])
  await expect(page.getByRole("heading", { level: 2, name: "Delivery" }).locator("..")).toContainText("Express")
  await expect(page.getByRole("heading", { level: 2, name: "Payment" }).locator("..")).toContainText("Paid")
})
