/**
 * REQUIREMENTS_3.md: "Platform maintains functionality across various
 * (320px, 768px, 1024px, 1440px) viewports."
 *
 * At each width a shopper browses to a category through the shop's menu,
 * opens a product, puts it in the cart, finds it in the cart preview and
 * reaches checkout, and no page scrolls sideways on the way.
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

/** How far the page in view is wider than the window; 0 when it fits. */
const overflowOf = (page: Page): Promise<number> =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))

for (const width of [320, 768, 1024, 1440]) {
  test(`at ${width} pixels a shopper finds a product through the menu, buys it, and reaches checkout`, async ({ page, request }) => {
    const { items } = await Storefront.fetchJson<{ items: { slug: string; name: string }[] }>(request, "/categories")
    const category = items[0]

    if (category === undefined) {
      throw new Error("The shop has no category.")
    }

    await page.setViewportSize({ width, height: 900 })
    await Checks.open(page, "/")
    expect(await overflowOf(page), "home").toBe(0)

    // The menu: a drawer below 1,024 pixels, the header's shop menu from there up.
    if (width < 1024) {
      await page.getByRole("button", { name: "Open menu" }).click()
      await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: category.name, exact: true }).click()
    } else {
      const menu = page.getByRole("navigation", { name: "Shop" })
      await menu.getByRole("button", { name: "Shop" }).click()
      await menu
        .getByRole("region", { name: "Shop by category" })
        .getByRole("link", { name: new RegExp(`^${category.name}`) })
        .click()
    }

    await expect(page.getByRole("heading", { level: 1, name: category.name })).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await overflowOf(page), "category").toBe(0)

    const firstProduct = page
      .getByRole("region", { name: /^\d+ items?/ })
      .getByRole("listitem")
      .first()
      .getByRole("heading", { level: 3 })
      .getByRole("link")
    const name = (await firstProduct.textContent()) ?? ""
    await firstProduct.click()
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await overflowOf(page), "product").toBe(0)

    await page.getByRole("button", { name: "Add to cart" }).click()
    const preview = page.getByRole("region", { name: "Cart preview" })
    await expect(preview).toBeVisible()
    await expect(preview).toContainText(name)
    expect(await overflowOf(page), "cart preview").toBe(0)

    await preview.getByRole("link", { name: "Checkout" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Place order" })).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await overflowOf(page), "checkout").toBe(0)
  })
}
