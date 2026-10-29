/**
 * REQUIREMENTS_2.md: "The shopping cart displays product information for
 * each item, including name, price, and a thumbnail image."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./storefront.ts"

test("each cart line shows its product's name, price and a thumbnail that loaded", async ({ context, page }) => {
  const products = await Storefront.findProducts(context.request, 2, 2)
  for (const product of products) await Storefront.addToCart(context.request, product, 2)

  await Checks.open(page, "/cart")

  for (const product of products) {
    const line = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton", { name: `Quantity of ${product.name}` }) })
    const thumbnail = line.getByRole("img")

    await expect(line.getByRole("link").getByText(product.name, { exact: true })).toBeVisible()
    await expect(line.getByText(`${Storefront.euros(product.priceCents)} each`, { exact: true })).toBeVisible()
    await expect(line.getByText(Storefront.euros(product.priceCents * 2), { exact: true })).toBeVisible()

    await expect(thumbnail).toHaveCount(1)
    await expect(thumbnail).toBeVisible()
    await expect(thumbnail).toHaveAttribute("alt", /\S/)
    expect(product.images.map((image) => image.url)).toContain(await thumbnail.getAttribute("src"))
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0))).toBeGreaterThan(0)
  }
})
