/**
 * REQUIREMENTS_3.md: "Quick cart preview (pop-up/drop-down or similar) is
 * implemented."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

test("the header's cart button opens a preview of the cart on any page, with its items, subtotal and the ways on", async ({
  context,
  page,
}) => {
  const [first, second] = await Storefront.pickProducts(context.request, 2)

  if (first === undefined || second === undefined) {
    throw new Error("The catalog has too few products.")
  }

  const preview = page.getByRole("region", { name: "Cart preview" })

  await Checks.open(page, "/about")
  await page.getByRole("button", { name: "Cart, empty" }).click()
  await expect(preview).toContainText("Your cart is empty.")
  await page.keyboard.press("Escape")

  // Adding a product opens the preview by itself.
  await Checks.open(page, `/products/${first.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(preview).toBeVisible()
  await expect(preview).toContainText(`1 × ${Storefront.formatPrice(first.priceCents)}`)
  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()

  // On another page, the button counts what the cart holds and opens the same preview.
  await Storefront.addToCart(context.request, second.id, 2)
  await Checks.open(page, "/faq")
  await page.getByRole("button", { name: "Cart, 3 items" }).click()

  await expect(preview).toContainText("3 items in your cart")
  await expect(preview.getByRole("link", { name: first.name, exact: true })).toBeVisible()
  await expect(preview.getByRole("link", { name: second.name, exact: true })).toBeVisible()
  await expect(preview).toContainText(`2 × ${Storefront.formatPrice(second.priceCents)}`)
  await expect(preview).toContainText(`Subtotal${Storefront.formatPrice(first.priceCents + 2 * second.priceCents)}`)
  await expect(preview.getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout")

  await preview.getByRole("link", { name: "View cart" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible()
})
