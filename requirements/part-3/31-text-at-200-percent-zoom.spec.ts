/**
 * REQUIREMENTS_3.md: "Text remains readable when zoomed to 200%."
 *
 * A browser's zoom: a 1,280 by 900 window at 200% lays the page out in 640
 * by 450 CSS pixels drawn twice as large. Readable means no line runs off
 * the side of the window and no text is cut off by the box it is in. The
 * relative units the task asks for are checked by doubling the root font
 * size, which has to double the text with it.
 */

import { expect, test, type Page } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./support/storefront.ts"

/** The pages read at 200%. */
const paths = ["/", "/shop", "/about", "/contact", "/cart", "/checkout"]

/**
 * What the page in view does wrong at its zoom: how far it is wider than the
 * window, and each element whose own text is cut off by its box or runs
 * past the right edge of the window. A box that ends its text with an
 * ellipsis or scrolls on purpose, as a table does, is left out.
 */
const problemsOf = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const cut: string[] = []

    for (const element of document.querySelectorAll<HTMLElement>("main *, header *, footer *")) {
      const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0)
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()

      if (
        !ownText ||
        box.width === 0 ||
        style.visibility === "hidden" ||
        element.closest(".sr-only, [hidden], dialog:not([open])") !== null
      ) {
        continue
      }

      const isClipped =
        ["hidden", "clip"].includes(style.overflowX) && style.textOverflow !== "ellipsis" && element.scrollWidth > element.clientWidth + 1

      if (isClipped || box.right > width + 1) {
        cut.push(`${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`)
      }
    }

    return { overflow: Math.max(0, document.documentElement.scrollWidth - width), cut }
  })

/** The font sizes of the page's body, its h1 and its first paragraph of main text, in CSS pixels. */
const textSizesOf = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [document.body, document.querySelector("main h1"), document.querySelector("main p")].map((element) =>
      element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize),
    ),
  )

test.beforeEach(async ({ context }) => {
  const [product] = await Storefront.pickProducts(context.request, 1)
  await Storefront.addToCart(context.request, product?.id ?? "")
})

test("zooming the whole page to 200% keeps every line of text in the window and whole", async ({ browser, baseURL, context }) => {
  // The same visitor, with the cart filled above, in a window zoomed to 200%.
  const zoomed = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    ignoreHTTPSErrors: true,
    viewport: { width: 640, height: 450 },
    deviceScaleFactor: 2,
    storageState: await context.storageState(),
  })
  const page = await zoomed.newPage()

  for (const path of paths) {
    await Checks.open(page, path)

    expect(await problemsOf(page), path).toEqual({ overflow: 0, cut: [] })
  }

  await zoomed.close()
})

test("the text is sized in relative units, so a reader's larger text setting enlarges all of it", async ({ page }) => {
  for (const path of paths) {
    await Checks.open(page, path)
    const before = await textSizesOf(page)

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })

    expect(await textSizesOf(page), path).toEqual(before.map((size) => 2 * size))
  }
})
