/**
 * REQUIREMENTS_3.md: "Product detail page shows complete product
 * information, images, reviews, CTA and related/recommended products."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type ListedProduct } from "./support/storefront.ts"

/** A product as its own page reads it. */
type Detail = ListedProduct & {
  description: string
  properties: { name: string; value: string }[]
  weight: { grams: number }
}

test("the product page shows the product's information, pictures, reviews, a way to buy it and related products", async ({
  page,
  request,
}) => {
  const [picked] = await Storefront.pickProducts(request, 1)
  const product = await Storefront.fetchJson<Detail>(request, `/products/${picked?.slug ?? ""}`)
  const reviews = await Storefront.fetchJson<{ count: number; items: { authorName: string }[] }>(
    request,
    `/products/${product.slug}/reviews`,
  )
  const related = await Storefront.fetchJson<{ items: ListedProduct[] }>(request, `/products/${product.slug}/related`)
  expect(reviews.count).toBeGreaterThan(0)
  expect(related.items.length).toBeGreaterThan(0)

  await Checks.open(page, `/products/${product.slug}`)
  const main = page.getByRole("main")

  // The information: name, brand, category, price, stock, description, properties and measurements.
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(product.name)
  await expect(main.getByRole("link", { name: product.brand.name, exact: true }).first()).toBeVisible()
  await expect(main.getByRole("navigation", { name: "Breadcrumb" })).toContainText(product.category.name)
  await expect(main.getByText(Storefront.formatPrice(product.priceCents), { exact: true }).first()).toBeVisible()
  await expect(main.getByText(product.description.split("\n")[0] ?? "").first()).toBeVisible()
  const terms = await main.getByRole("term").allTextContents()
  const definitions = await main.getByRole("definition").allTextContents()
  expect(product.properties.length).toBeGreaterThan(0)
  expect(terms).toEqual(expect.arrayContaining(product.properties.map((property) => property.name)))
  expect(definitions).toEqual(expect.arrayContaining(product.properties.map((property) => property.value)))
  await expect(main.getByRole("heading", { level: 2, name: "Measurements" })).toBeVisible()
  await expect(main).toContainText(`${product.weight.grams} g`)

  // The pictures, with a full-size view.
  await expect(main.getByRole("img", { name: product.images[0]?.alt ?? "" }).first()).toBeVisible()
  await main.getByRole("button", { name: "View full size" }).click()
  const fullSize = page.getByRole("dialog", { name: product.name })
  await expect(fullSize.getByRole("img")).toHaveAttribute("src", product.images[0]?.url ?? "")
  await page.keyboard.press("Escape")

  // The reviews, with the rating they add up to.
  const reviewSection = main.getByRole("region", { name: "Reviews" })
  await expect(reviewSection.getByRole("list", { name: "Reviews by stars" })).toBeVisible()
  await expect(reviewSection).toContainText(reviews.items[0]?.authorName ?? "")
  await expect(reviewSection.getByLabel("Sort reviews by")).toHaveValue("helpful")

  // The call to action.
  await main.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("button", { name: "Cart, 1 item" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Cart preview" })).toContainText(product.name)
  await page.keyboard.press("Escape")

  // The related products, each a link to its own page.
  const row = main.getByRole("region", { name: `More from ${product.category.name}` })
  await expect(row.getByRole("heading", { level: 3 })).toHaveText(related.items.map((item) => item.name))
  await row.getByRole("link", { name: related.items[0]?.name ?? "", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${related.items[0]?.slug ?? ""}$`))
})
