/**
 * REQUIREMENTS_3.md: "Shopping cart page lists items with thumbnails,
 * prices, quantities, allows updates/removals, displays total (excluding
 * shipping), and provides clear CTA."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

test("the cart lists each item with its picture, price and quantity, follows changes in its subtotal, and leads to checkout", async ({
  context,
  page,
}) => {
  const [first, second] = await Storefront.pickProducts(context.request, 2)

  if (first === undefined || second === undefined) {
    throw new Error("The catalog has too few products.")
  }

  await Storefront.addToCart(context.request, first.id, 1)
  await Storefront.addToCart(context.request, second.id, 2)
  await Checks.open(page, "/cart")
  const lines = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("spinbutton") })
  const subtotal = page.getByText(/^Subtotal \(\d+ items?\)$/)
  const subtotalAmount = subtotal.locator("xpath=following-sibling::span[1]")
  const lineOf = (name: string) => lines.filter({ has: page.getByRole("link", { name, exact: true }) }).first()

  // Every line: its thumbnail, name, unit price, quantity and line total.
  await expect(lines).toHaveCount(2)

  for (const [product, quantity] of [
    [first, 1],
    [second, 2],
  ] as const) {
    const line = lineOf(product.name)

    await expect(line.getByRole("img", { name: product.images[0]?.alt ?? "" })).toBeVisible()
    await expect(line).toContainText(`${Storefront.formatPrice(product.priceCents)} each`)
    await expect(line.getByLabel(`Quantity of ${product.name}`)).toHaveValue(String(quantity))
    await expect(line).toContainText(Storefront.formatPrice(product.priceCents * quantity))
  }

  // The subtotal is the items alone: no shipping is added to it.
  await expect(subtotal).toHaveText("Subtotal (3 items)")
  await expect(subtotalAmount).toHaveText(Storefront.formatPrice(first.priceCents + 2 * second.priceCents))

  // An update.
  await page.getByRole("button", { name: `One more ${first.name}` }).click()
  await expect(lineOf(first.name).getByLabel(`Quantity of ${first.name}`)).toHaveValue("2")
  await expect(subtotal).toHaveText("Subtotal (4 items)")
  await expect(subtotalAmount).toHaveText(Storefront.formatPrice(2 * first.priceCents + 2 * second.priceCents))

  // A removal.
  await page.getByRole("button", { name: `Remove ${second.name}` }).click()
  await expect(lines).toHaveCount(1)
  await expect(subtotal).toHaveText("Subtotal (2 items)")
  await expect(subtotalAmount).toHaveText(Storefront.formatPrice(2 * first.priceCents))

  // The call to action.
  await page.getByRole("link", { name: "Go to checkout" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible()
})
