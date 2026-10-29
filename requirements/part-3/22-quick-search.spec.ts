/**
 * REQUIREMENTS_3.md: "Quick search with dynamic suggestions is implemented."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

/** A suggestion as the API makes it. */
type Suggestion = { slug: string; name: string; priceCents: number }

test("the header's search box suggests products as the text grows, with their prices, and opens the one chosen", async ({
  page,
  request,
}) => {
  const suggestionsFor = async (text: string): Promise<readonly Suggestion[]> =>
    (await Storefront.fetchJson<{ items: Suggestion[] }>(request, `/products/suggest?q=${encodeURIComponent(text)}&limit=6`)).items

  await Checks.open(page, "/about")
  const box = page.getByRole("combobox", { name: "Search products" })
  const options = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option")

  for (const text of ["di", "diamond", "diamond pick"]) {
    const expected = await suggestionsFor(text)
    expect(expected.length, text).toBeGreaterThan(0)

    await box.fill(text)

    await expect(options, text).toHaveCount(expected.length + 1)

    for (const [index, suggestion] of expected.entries()) {
      await expect(options.nth(index)).toContainText(suggestion.name)
      await expect(options.nth(index)).toContainText(Storefront.formatPrice(suggestion.priceCents))
    }

    await expect(options.last()).toHaveText(`Search for "${text}"`)
  }

  const [chosen] = await suggestionsFor("diamond pick")
  await options.first().click()

  await expect(page).toHaveURL(new RegExp(`/products/${chosen?.slug ?? ""}$`))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(chosen?.name ?? "")
})

test("the last suggestion searches the whole catalog for the text", async ({ page }) => {
  await Checks.open(page, "/")

  await page.getByRole("combobox", { name: "Search products" }).fill("pickaxe")
  await page.getByRole("option", { name: 'Search for "pickaxe"' }).click()

  await expect(page).toHaveURL(/\/search\?q=pickaxe$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText('Results for "pickaxe"')
})
