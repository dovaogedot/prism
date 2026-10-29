/**
 * REQUIREMENTS_3.md: "All meaningful images include descriptive alt text."
 *
 * A picture that stands beside the name it shows, such as a category tile's
 * or a suggestion's, is decorative and has an empty alt, so a screen reader
 * does not read the name twice.
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

/** Every picture of the page: its address, and its alt, or `undefined` when it has none. */
const picturesOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("img")].map((image) => ({
      src: image.getAttribute("src") ?? "",
      alt: image.getAttribute("alt") ?? undefined,
    })),
  )

test("every picture on the shop's pages has alt text, and every meaningful one names what it shows", async ({ context, page }) => {
  const [product] = await Storefront.pickProducts(context.request, 1)

  if (product === undefined) {
    throw new Error("The catalog has no product with a picture.")
  }

  await Storefront.addToCart(context.request, product.id)
  const { items: listed } = await Storefront.search(context.request, "q=stone&perPage=60")
  const names = new Set([...listed, product].map((item) => item.name))
  const problems: string[] = []
  let meaningful = 0

  for (const path of ["/", "/shop", "/shop?view=list", "/search?q=stone&perPage=60", `/products/${product.slug}`, "/cart"]) {
    await Checks.open(page, path)

    for (const picture of await picturesOf(page)) {
      if (picture.alt === undefined) {
        problems.push(`${path}: ${picture.src} has no alt`)
      } else if (picture.alt.length > 0) {
        meaningful += 1

        // A file name or a word like "image" says nothing about what the picture shows.
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(picture.alt) || /^(image|picture|photo|img)\b/i.test(picture.alt)) {
          problems.push(`${path}: ${picture.src} has the alt "${picture.alt}"`)
        }
      }
    }
  }

  expect(problems).toEqual([])
  expect(meaningful).toBeGreaterThan(20)

  // The product pictures of a result list are each named after their product.
  await Checks.open(page, "/search?q=stone&perPage=60")
  const alts = await page
    .getByRole("main")
    .getByRole("listitem")
    .getByRole("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("alt") ?? ""))
  expect(alts.length).toBeGreaterThan(0)
  expect(alts.filter((alt) => !names.has(alt))).toEqual([])
})

test("the product page's main picture and its full-size view are named after the product", async ({ page, request }) => {
  const [product] = await Storefront.pickProducts(request, 1)

  await Checks.open(page, `/products/${product?.slug ?? ""}`)
  await page.getByRole("button", { name: "View full size" }).click()

  await expect(
    page
      .getByRole("main")
      .getByRole("img", { name: product?.name ?? "", exact: true })
      .first(),
  ).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("img", { name: product?.name ?? "", exact: true })).toBeVisible()
})
