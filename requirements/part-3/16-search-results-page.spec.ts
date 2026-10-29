/**
 * REQUIREMENTS_3.md: "Search results page includes filtering, sorting,
 * result count and pagination."
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type FacetBucket } from "./support/storefront.ts"

/** The search every check here makes: a word that names products on several pages. */
const query = "stone"

/** The results region, named by its count. */
const resultsOf = (page: Page) => page.getByRole("region", { name: /^\d+ items?/ })

/** The names of the products the results show, in order. */
const namesOf = async (page: Page): Promise<readonly string[]> => {
  await expect(resultsOf(page)).toHaveAttribute("aria-busy", "false")

  return resultsOf(page).getByRole("listitem").getByRole("heading", { level: 3 }).allTextContents()
}

test("the results say how many products match, and on how many pages", async ({ page, request }) => {
  const { total, totalPages } = await Storefront.search(request, `q=${query}`)
  expect(totalPages).toBeGreaterThan(1)

  await Checks.open(page, `/search?q=${query}`)

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Results for "${query}"`)
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${total} items`) })).toContainText(`page 1 of ${totalPages}`)
})

test("the results page through to the next page and back", async ({ page, request }) => {
  const first = await Storefront.search(request, `q=${query}`)
  const second = await Storefront.search(request, `q=${query}&page=2`)

  await Checks.open(page, `/search?q=${query}`)
  const pages = page.getByRole("navigation", { name: "Result pages" })

  await expect.poll(() => namesOf(page)).toEqual(first.items.map((item) => item.name))
  await pages.getByRole("button", { name: "Next" }).click()

  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(pages).toContainText(`Page 2 of ${first.totalPages}`)
  await expect.poll(() => namesOf(page)).toEqual(second.items.map((item) => item.name))

  await pages.getByRole("button", { name: "Previous" }).click()
  await expect(pages).toContainText(`Page 1 of ${first.totalPages}`)
  await expect.poll(() => namesOf(page)).toEqual(first.items.map((item) => item.name))
})

test("the results sort by price and by rating", async ({ page, request }) => {
  await Checks.open(page, `/search?q=${query}`)

  for (const [label, sort] of [
    ["Price: high to low", "price_desc"],
    ["Price: low to high", "price_asc"],
    ["Top rated", "rating"],
  ] as const) {
    const { items } = await Storefront.search(request, `q=${query}&sort=${sort}`)

    await page.getByLabel("Sort by").selectOption({ label })

    await expect(page).toHaveURL(new RegExp(`[?&]sort=${sort}`))
    await expect.poll(() => namesOf(page), { message: label }).toEqual(items.map((item) => item.name))
  }
})

test("a filter narrows the results, and its count is the new result count", async ({ page, request }) => {
  const { total, facets } = await Storefront.search(request, `q=${query}`)
  // A value among the first eight of its group, which shows them before "Show more".
  const narrows = (bucket: FacetBucket): boolean => bucket.count > 0 && bucket.count < total
  const property = facets.properties.find((facet) => facet.buckets.slice(0, 8).some(narrows))
  const bucket = property?.buckets.slice(0, 8).find(narrows)

  if (property === undefined || bucket === undefined) {
    throw new Error(`No filter narrows the results for "${query}".`)
  }

  const narrowed = await Storefront.search(request, `q=${query}&p.${encodeURIComponent(property.name)}=${encodeURIComponent(bucket.value)}`)

  await Checks.open(page, `/search?q=${query}`)
  const group = page.getByRole("complementary", { name: "Filters" }).getByRole("group", { name: property.name, exact: true })
  const checkbox = group.locator("label", { has: page.getByText(bucket.label, { exact: true }) }).getByRole("checkbox")
  await checkbox.click()

  await expect(page).toHaveURL(new RegExp(`[?&]p\\.${encodeURIComponent(property.name)}=`))
  await expect(checkbox).toBeChecked()

  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${bucket.count} items?`) })).toBeVisible()
  expect(narrowed.total).toBe(bucket.count)
  await expect.poll(() => namesOf(page)).toEqual(narrowed.items.map((item) => item.name))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Results for "${query}"`)
})
