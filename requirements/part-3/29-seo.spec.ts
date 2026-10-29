/**
 * REQUIREMENTS_3.md: "The platform implements basic SEO best practices
 * including title tags under 60 characters, proper heading hierarchy
 * (H2-H6), logical URL structure, and descriptive alt text for images."
 *
 * A product page's title is made from its name and its category, so the
 * product pages checked for length are those with the longest of both.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront, type ListedProduct } from "./support/storefront.ts"

/** The pages every check here reads, besides the product pages it picks. */
const pages = [
  "/",
  "/shop",
  "/search?q=stone",
  "/about",
  "/contact",
  "/faq",
  "/terms",
  "/privacy",
  "/cart",
  "/checkout",
  "/login",
  "/register",
]

/** Every product of the catalog, read page by page. */
const allProducts = async (request: APIRequestContext): Promise<readonly ListedProduct[]> => {
  const first = await Storefront.search(request, "perPage=60&page=1")
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) => Storefront.search(request, `perPage=60&page=${index + 2}`)),
  )

  return [first, ...rest].flatMap((result) => result.items)
}

/** The levels of the headings the page renders, in document order: a closed dialog's or menu's are left out. */
const headingLevels = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter((heading) => heading.checkVisibility())
      .map((heading) => Number(heading.tagName.slice(1))),
  )

test("every page's title is under 60 characters, the longest product titles included", async ({ page, request }) => {
  const { items: categories } = await Storefront.fetchJson<{ items: { slug: string }[] }>(request, "/categories")
  const fullTitleOf = (product: ListedProduct): string => `${product.name} - ${product.category.name} | Prism`
  const longest = (await allProducts(request)).toSorted((a, b) => fullTitleOf(b).length - fullTitleOf(a).length).slice(0, 3)
  const titles: string[] = []

  // The longest names would make titles of 60 characters or more, so their pages show the title is cut to fit.
  expect(longest.map((product) => fullTitleOf(product).length).every((length) => length >= 60)).toBe(true)

  for (const path of [
    ...pages,
    ...categories.map((category) => `/categories/${category.slug}`),
    ...longest.map((product) => `/products/${product.slug}`),
  ]) {
    await Checks.open(page, path)
    titles.push(await page.title())
  }

  expect(titles.filter((title) => title.length >= 60)).toEqual([])
  expect(titles.filter((title) => !title.endsWith(" | Prism"))).toEqual([])
})

test("every page has one h1, and its h2 to h6 headings never skip a level", async ({ page, request }) => {
  const [product] = await Storefront.pickProducts(request, 1)
  const skipped: string[] = []

  for (const path of [...pages, `/categories/${product?.category.slug ?? ""}`, `/products/${product?.slug ?? ""}`]) {
    await Checks.open(page, path)
    const levels = await headingLevels(page)

    expect(levels[0], path).toBe(1)
    expect(
      levels.filter((level) => level === 1),
      path,
    ).toHaveLength(1)
    skipped.push(
      ...levels.flatMap((level, index) =>
        index > 0 && level > (levels[index - 1] ?? 0) + 1 ? [`${path}: h${levels[index - 1]} then h${level}`] : [],
      ),
    )
  }

  expect(skipped).toEqual([])
})

test("addresses name what they show: products and categories by their names, searches, filters and pages in the query", async ({
  page,
  request,
}) => {
  const { items } = await Storefront.search(request, "")
  const { items: categories } = await Storefront.fetchJson<{ items: { slug: string; name: string }[] }>(request, "/categories")

  for (const product of items) {
    expect(product.slug, product.name).toMatch(new RegExp(`^${Storefront.slugify(product.name)}(-\\d+)?$`))
  }

  for (const category of categories) {
    expect(category.slug, category.name).toBe(Storefront.slugify(category.name))
  }

  await Checks.open(page, "/shop")
  const links = await page
    .getByRole("main")
    .getByRole("link")
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""))
  expect(links).toEqual(expect.arrayContaining(items.map((product) => `/products/${product.slug}`)))
  expect(links).toEqual(expect.arrayContaining(categories.map((category) => `/categories/${category.slug}`)))

  await page.getByRole("combobox", { name: "Search products" }).fill("stone")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/search\?q=stone$/)
  await page.getByRole("navigation", { name: "Result pages" }).getByRole("button", { name: "Next" }).click()
  await expect(page).toHaveURL(/\/search\?q=stone&page=2$/)
})

test("product pictures carry alt text that names the product", async ({ page, request }) => {
  const [product] = await Storefront.pickProducts(request, 1)

  await Checks.open(page, `/products/${product?.slug ?? ""}`)
  const gallery = page.getByRole("main").getByRole("article").getByRole("img").first()

  await expect(gallery).toHaveAttribute("alt", product?.images[0]?.alt ?? "")
  expect(product?.images[0]?.alt).toContain(product?.name ?? "")
})
