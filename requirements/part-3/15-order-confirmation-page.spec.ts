/**
 * REQUIREMENTS_3.md: "Order confirmation page displays order summary
 * estimated delivery and reference number."
 *
 * The order is placed through the checkout page as a guest. The browser
 * suite's stack takes payments simulated, which settle at once.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

/** An order as its page reads it. */
type Order = {
  number: number
  status: string
  subtotalCents: number
  shippingCents: number
  totalCents: number
  shippingMethodName: string
  payment?: { reference?: string }
}

test("placing an order opens its confirmation: the summary, the expected delivery, the order number and the payment reference", async ({
  context,
  page,
}) => {
  const [product] = await Storefront.pickProducts(context.request, 1)

  if (product === undefined) {
    throw new Error("The catalog has no product to buy.")
  }

  await Storefront.addToCart(context.request, product.id)
  await Checks.open(page, "/checkout")
  const contact = page.getByRole("group", { name: "1. Contact" })
  const address = page.getByRole("group", { name: "2. Shipping address" })
  await contact.getByLabel("Full name").fill("Mari Maasikas")
  await contact.getByLabel("Email").fill(`confirmation-${Date.now()}@example.com`)
  await contact.getByLabel("Phone").fill("+372 5123 4567")
  await address.getByLabel("Street and house number").fill("Narva mnt 7")
  await address.getByLabel("City").fill("Tallinn")
  await address.getByLabel("Postal code").fill("10117")
  await page.getByRole("button", { name: "Place order" }).click()

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+\?placed=1&key=/)
  const confirmed = page.getByRole("alert").filter({ hasText: "Thank you, your order is confirmed" })
  await expect(confirmed).toBeVisible()
  const url = new URL(page.url())
  const order = await Storefront.fetchJson<Order>(context.request, `${url.pathname}?key=${url.searchParams.get("key") ?? ""}`)

  // The order number, and when it should arrive.
  await expect(confirmed).toContainText(`Your order number is #${order.number}, and it should arrive`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Order #${order.number}`)
  await expect(page.getByRole("heading", { level: 2, name: "Delivery" }).locator("xpath=..")).toContainText(
    new RegExp(`${order.shippingMethodName}\\s*Expected \\S`),
  )

  // The summary: the item and the totals.
  const items = page.getByRole("heading", { level: 2, name: "Items" }).locator("xpath=..")
  await expect(items).toContainText(product.name)
  await expect(items).toContainText(`1 × ${Storefront.formatPrice(product.priceCents)}`)
  await expect(items).toContainText(`Subtotal${Storefront.formatPrice(order.subtotalCents)}`)
  await expect(items).toContainText(`Total${Storefront.formatPrice(order.totalCents)}`)

  // The payment's reference.
  expect(order.payment?.reference).toMatch(/^pi_/)
  await expect(page.getByRole("heading", { level: 2, name: "Payment" }).locator("xpath=..")).toContainText(
    `Reference ${order.payment?.reference ?? ""}`,
  )
})
