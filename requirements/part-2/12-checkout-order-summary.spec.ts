/**
 * REQUIREMENTS_2.md: "An order summary is provided during checkout,
 * displaying all items, quantities, and costs."
 */

import { expect, test, type Locator } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type DeliveryOption } from "./storefront.ts"

/** The amount beside `term` in a summary's list of totals. */
const amountOf = (totals: Locator, term: string): Locator =>
  totals.locator(`xpath=.//dt[normalize-space()="${term}"]/following-sibling::dd[1]`)

test("checkout shows every item with its quantity and price, and the subtotal, shipping and total, which follow the delivery chosen", async ({
  context,
  page,
}) => {
  const products = await Storefront.findProducts(context.request, 2, 3)
  const quantities = [3, 1]
  for (const [index, product] of products.entries()) await Storefront.addToCart(context.request, product, quantities[index] ?? 1)

  const subtotalCents = products.reduce((sum, product, index) => sum + product.priceCents * (quantities[index] ?? 1), 0)
  const [standard, express] = await Storefront.findDeliveryOptions(context.request)
  if (standard === undefined || express === undefined) throw new Error("Checkout offers fewer than two delivery options.")

  await Checks.open(page, "/checkout")

  for (const [index, product] of products.entries()) {
    const quantity = quantities[index] ?? 1
    const item = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton", { name: `Quantity of ${product.name}` }) })

    await expect(item.getByRole("link").getByText(product.name, { exact: true })).toBeVisible()
    await expect(item.getByRole("spinbutton")).toHaveValue(String(quantity))
    await expect(item.getByText(`${Storefront.euros(product.priceCents)} each`, { exact: true })).toBeVisible()
    await expect(item.getByText(Storefront.euros(product.priceCents * quantity), { exact: true })).toBeVisible()
  }

  const totals = page.getByRole("main").locator("dl").filter({ hasText: "Subtotal" })
  const totalWith = (option: DeliveryOption): string => Storefront.euros(subtotalCents + Storefront.shippingCentsOf(option, subtotalCents))

  await page.getByRole("radio", { name: new RegExp(`^${standard.name}`) }).check()
  await expect(amountOf(totals, "Subtotal")).toHaveText(Storefront.euros(subtotalCents))
  await expect(amountOf(totals, "Shipping")).toHaveText(Storefront.shippingText(standard, subtotalCents))
  await expect(amountOf(totals, "Total")).toHaveText(totalWith(standard))

  await page.getByRole("radio", { name: new RegExp(`^${express.name}`) }).check()
  await expect(amountOf(totals, "Shipping")).toHaveText(Storefront.shippingText(express, subtotalCents))
  await expect(amountOf(totals, "Total")).toHaveText(totalWith(express))

  // On a phone the summary folds above the form, and its fold shows the item count and the total.
  await page.setViewportSize({ width: 390, height: 900 })
  const itemCount = quantities.reduce((sum, quantity) => sum + quantity, 0)
  await expect(page.locator("summary").filter({ hasText: `Order summary (${itemCount})` })).toContainText(totalWith(express))
})
