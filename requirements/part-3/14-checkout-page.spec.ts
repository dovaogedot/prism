/**
 * REQUIREMENTS_3.md: "Checkout page contains guest/signed-in user order
 * summary, address input, shipping, and payment selection."
 *
 * The browser suite's stack takes payments simulated, so the payment part
 * says no card is needed; with Stripe's keys it holds Stripe's card fields.
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Stack } from "../../apps/e2e/support/stack.ts"
import { Storefront, type ListedProduct } from "./support/storefront.ts"

/** A delivery option as checkout offers it. */
type Option = { code: string; name: string; priceCents: number; freeFromCents?: number }

/** Checks the checkout of a cart holding `product` once: its parts, and a summary that follows the delivery chosen. */
const checkCheckout = async (page: Page, product: ListedProduct, options: readonly Option[]): Promise<void> => {
  await Checks.open(page, "/checkout")
  const form = page.getByRole("main").locator("form")
  const summary = page.getByRole("main").locator("dl").filter({ hasText: "Subtotal" })

  // The order summary: the line and the totals.
  await expect(page.getByRole("main").getByRole("link", { name: product.name, exact: true }).first()).toBeVisible()
  await expect(summary).toContainText(Storefront.formatPrice(product.priceCents))

  // The address input.
  const address = form.getByRole("group", { name: "2. Shipping address" })

  for (const field of ["Street and house number", "City", "Postal code", "Country"]) {
    await expect(address.getByLabel(field)).toBeEditable()
  }

  await expect(form.getByRole("group", { name: "1. Contact" }).getByLabel("Full name")).toBeEditable()
  await expect(form.getByRole("group", { name: "3. Billing address" }).getByLabel("Same as the shipping address")).toBeChecked()

  // The shipping choice, which the summary prices.
  const delivery = form.getByRole("group", { name: "4. Delivery" })
  await expect(delivery.getByRole("radio")).toHaveCount(options.length)

  for (const option of options) {
    const shipping = option.freeFromCents !== undefined && product.priceCents >= option.freeFromCents ? 0 : option.priceCents

    await delivery.getByRole("radio", { name: new RegExp(`^${option.name}`) }).check()
    await expect(summary).toContainText(`Total${Storefront.formatPrice(product.priceCents + shipping)}`)
  }

  // The payment part.
  const payment = form.getByRole("group", { name: "5. Payment" })
  await expect(payment).toContainText("No card needed")
  await expect(form.getByRole("button", { name: "Place order" })).toBeEnabled()
}

test("a guest's checkout has the order summary, the address, the delivery choice and the payment, and offers signing in", async ({
  context,
  page,
}) => {
  const [product] = await Storefront.pickProducts(context.request, 1)
  const { items } = await Storefront.fetchJson<{ items: Option[] }>(context.request, "/shipping-methods")

  if (product === undefined) {
    throw new Error("The catalog has no product to buy.")
  }

  await Storefront.addToCart(context.request, product.id)
  await checkCheckout(page, product, items)

  await expect(page.getByRole("link", { name: "Sign in for faster checkout" })).toBeVisible()
})

test("a signed-in customer's checkout has the same parts, starts from their account, and offers to save the address", async ({
  context,
  page,
}) => {
  const email = await Stack.registerCustomer(context.request, "checkout")
  const [product] = await Storefront.pickProducts(context.request, 1)
  const { items } = await Storefront.fetchJson<{ items: Option[] }>(context.request, "/shipping-methods")

  if (product === undefined) {
    throw new Error("The catalog has no product to buy.")
  }

  // Through the product page, so the item lands in the account's cart rather than a guest's.
  await Checks.open(page, `/products/${product.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("button", { name: "Cart, 1 item" })).toBeVisible()
  await checkCheckout(page, product, items)

  await expect(page.getByRole("group", { name: "1. Contact" }).getByLabel("Email")).toHaveValue(email)
  await expect(page.getByLabel("Save this address to my account")).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign in for faster checkout" })).toBeHidden()
})
