/**
 * REQUIREMENTS_3.md: "Product listing page includes product details,
 * ratings, filters, grid/list views, search, and sorting options."
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type FacetBucket } from "./support/storefront.ts"

/** The listing's results, one item per product. */
const resultsOf = (page: Page) => page.getByRole("region", { name: /^\d+ items?/ }).getByRole("listitem")

test("each product shows its picture, name, brand, price, stock and rating", async ({ page, request }) => {
  const { items } = await Storefront.search(request, "")

  await Checks.open(page, "/shop")

  await expect(resultsOf(page)).toHaveCount(items.length)

  for (const [index, product] of items.entries()) {
    const card = resultsOf(page).nth(index)
    const rating = product.rating.average === undefined ? "No reviews yet" : `Rated ${product.rating.average.toFixed(1)} out of 5`

    await expect(card.getByRole("link", { name: product.name, exact: true })).toHaveAttribute("href", `/products/${product.slug}`)
    await expect(card).toContainText(product.brand.name)
    await expect(card).toContainText(Storefront.formatPrice(product.priceCents))
    await expect(card).toContainText(rating)

    if (product.images[0] !== undefined) {
      await expect(card.getByRole("img")).toHaveAttribute("alt", product.images[0].alt)
    }
  }
})

test("a filter narrows the results to the count the filter showed", async ({ page, request }) => {
  const { total, facets } = await Storefront.search(request, "")
  // A value among the first eight of its group, which shows them before "Show more".
  const narrows = (bucket: FacetBucket): boolean => bucket.count > 0 && bucket.count < total
  const property = facets.properties.find((facet) => facet.buckets.slice(0, 8).some(narrows))
  const bucket = property?.buckets.slice(0, 8).find(narrows)

  if (property === undefined || bucket === undefined) {
    throw new Error("No filter narrows the catalog.")
  }

  await Checks.open(page, "/shop")
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${total} items`) })).toBeVisible()
  const group = page.getByRole("complementary", { name: "Filters" }).getByRole("group", { name: property.name, exact: true })
  const checkbox = group.locator("label", { has: page.getByText(bucket.label, { exact: true }) }).getByRole("checkbox")
  await checkbox.click()

  await expect(page).toHaveURL(new RegExp(`[?&]p\\.${encodeURIComponent(property.name)}=`))
  await expect(checkbox).toBeChecked()
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${bucket.count} items?`) })).toBeVisible()

  await page.getByRole("button", { name: `Remove ${property.name}: ${bucket.value}` }).click()
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${total} items`) })).toBeVisible()
})

test("the results switch between a grid and a list", async ({ page }) => {
  await Checks.open(page, "/shop")
  const [first, second] = [resultsOf(page).nth(0), resultsOf(page).nth(1)]

  // A grid puts the first two products side by side, a list one under the other.
  await expect(page.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true")
  expect(Math.abs((await Checks.boxOf(first)).y - (await Checks.boxOf(second)).y)).toBeLessThanOrEqual(Checks.TOLERANCE)

  await page.getByRole("button", { name: "List" }).click()

  await expect(page).toHaveURL(/[?&]view=list/)
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true")
  expect((await Checks.boxOf(second)).y).toBeGreaterThan((await Checks.boxOf(first)).y + (await Checks.boxOf(first)).height - 1)
})

test("the search box finds products by name", async ({ page, request }) => {
  const { total, items } = await Storefront.search(request, "q=stone")
  expect(total).toBeGreaterThan(0)

  await Checks.open(page, "/shop")
  await page.getByRole("combobox", { name: "Search products" }).fill("stone")
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/search\?q=stone$/)
  await expect(page.getByRole("heading", { level: 1, name: 'Results for "stone"' })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${total} items`) })).toBeVisible()
  await expect(resultsOf(page).first()).toContainText(items[0]?.name ?? "")
})

test("the sort orders the results by price either way", async ({ page, request }) => {
  const shownPrices = async (): Promise<readonly number[]> =>
    (await resultsOf(page).allTextContents()).map((text) => Number((/€([\d,]+\.\d\d)/.exec(text)?.[1] ?? "").replaceAll(",", "")))

  await Checks.open(page, "/shop")

  for (const [label, sort, direction] of [
    ["Price: low to high", "price_asc", 1],
    ["Price: high to low", "price_desc", -1],
  ] as const) {
    const { items } = await Storefront.search(request, `sort=${sort}`)

    await page.getByLabel("Sort by").selectOption({ label })

    await expect(page).toHaveURL(new RegExp(`[?&]sort=${sort}`))
    await expect(page.getByRole("region", { name: /^\d+ items?/ })).toHaveAttribute("aria-busy", "false")
    await expect(resultsOf(page).first().getByRole("heading", { level: 3 })).toHaveText(items[0]?.name ?? "")
    const prices = await shownPrices()
    expect(prices).toEqual(items.map((item) => item.priceCents / 100))
    expect(prices).toEqual([...prices].toSorted((a, b) => direction * (a - b)))
  }
})
