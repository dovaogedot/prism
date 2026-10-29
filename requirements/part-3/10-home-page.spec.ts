/**
 * REQUIREMENTS_3.md: "Home page showcases featured products and
 * collections."
 *
 * The collections are the shop's categories.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type ListedProduct } from "./support/storefront.ts"

test("the home page shows the products staff feature, each a link to its page", async ({ page, request }) => {
  const { featured } = await Storefront.fetchJson<{ featured: ListedProduct[] }>(request, "/home")
  expect(featured.length).toBeGreaterThan(0)

  await Checks.open(page, "/")
  const row = page.getByRole("region", { name: "Featured" })

  await expect(row.getByRole("heading", { level: 3 })).toHaveText(featured.map((product) => product.name))

  for (const product of featured) {
    await expect(row.getByRole("link", { name: product.name, exact: true })).toHaveAttribute("href", `/products/${product.slug}`)
  }

  await row.getByRole("link", { name: featured[0]?.name ?? "", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: featured[0]?.name ?? "" })).toBeVisible()
})

test("the home page shows every collection with how many items it holds, and opens one", async ({ page, request }) => {
  const { items } = await Storefront.fetchJson<{ items: { slug: string; name: string; productCount: number }[] }>(request, "/categories")
  expect(items.length).toBeGreaterThan(0)

  await Checks.open(page, "/")
  const tiles = page.getByRole("region", { name: "Shop by category" }).getByRole("link")

  await expect(tiles).toHaveCount(items.length)

  for (const [index, category] of items.entries()) {
    await expect(tiles.nth(index)).toHaveAttribute("href", `/categories/${category.slug}`)
    await expect(tiles.nth(index)).toContainText(category.name)
    await expect(tiles.nth(index)).toContainText(`${category.productCount} items`)
  }

  await tiles.first().click()
  await expect(page.getByRole("heading", { level: 1, name: items[0]?.name ?? "" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: `${items[0]?.productCount ?? 0} items` })).toBeVisible()
})
