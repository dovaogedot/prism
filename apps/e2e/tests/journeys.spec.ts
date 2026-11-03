/**
 * What a visitor does with a keyboard and a screen reader in mind: the skip
 * link, the header's controls, the search box, the cart preview, the links
 * of an order's page, and where focus and the view land when a page changes.
 * And the answers a crawler gets: a real 404 for an address outside the
 * route list, and for a product or a category the shop does not have.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../support/checks.ts"
import { Stack } from "../support/stack.ts"

test("the skip link is the first thing Tab reaches, and leads to the main content", async ({ page }) => {
  await Checks.open(page, "/")

  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused()

  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#main$/)
})

test("Tab reaches the search box, the shop menu, the cart and signing in, in that order", async ({ page }) => {
  await Checks.open(page, "/")
  const reached: string[] = []

  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab")
    reached.push(
      await page.evaluate(() => {
        const focused = document.activeElement
        const label = focused instanceof HTMLInputElement ? focused.labels?.[0]?.textContent : undefined
        return (focused?.getAttribute("aria-label") ?? label ?? focused?.textContent ?? "").trim()
      }),
    )
  }

  const order = ["Shop", "Search products", "Cart, empty", "Sign in"].map((name) => reached.findIndex((label) => label.startsWith(name)))
  expect(
    order.every((index) => index >= 0),
    reached.join(" / "),
  ).toBe(true)
  expect(order).toEqual([...order].toSorted((a, b) => a - b))
})

test("the search box suggests products, and the keyboard opens one", async ({ page }) => {
  await Checks.open(page, "/")
  const box = page.getByRole("combobox", { name: "Search products" })

  await page.keyboard.press("/")
  await expect(box).toBeFocused()
  await page.keyboard.type("diamond sw")
  await expect(page.getByRole("option", { name: /Diamond Sword/ }).first()).toBeVisible()
  await expect(box).toHaveAttribute("aria-expanded", "true")

  await page.keyboard.press("ArrowDown")
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/products\/diamond-sword$/)
  await expect(page.getByRole("heading", { level: 1, name: "Diamond Sword" })).toBeFocused()
})

test("Escape closes the suggestions, and a second Escape clears the box", async ({ page }) => {
  await Checks.open(page, "/")
  const box = page.getByRole("combobox", { name: "Search products" })

  await box.fill("sword")
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(box).toHaveValue("")
})

test("Enter on typed text searches, and a misspelling shows similar names and says so", async ({ page }) => {
  await Checks.open(page, "/")

  await page.getByRole("combobox", { name: "Search products" }).fill("diamnd sword")
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/search\?q=diamnd%20sword$/)
  await expect(page.getByRole("status").filter({ hasText: 'No exact matches for "diamnd sword". Showing similar names.' })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "Diamond Sword" })).toBeVisible()
})

test("adding to the cart opens its preview, and Escape closes it and gives focus back", async ({ page }) => {
  await Checks.open(page, `/products/${Stack.PRODUCT_SLUG}`)

  await page.getByRole("button", { name: "Add to cart" }).click()
  const preview = page.getByRole("region", { name: "Cart preview" })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText("Diamond Sword")
  await expect(preview.getByRole("link", { name: "Checkout" })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()

  const cart = page.getByRole("button", { name: /^Cart, / })
  await cart.focus()
  await page.keyboard.press("Enter")
  await expect(preview).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(cart).toBeFocused()
})

test("an order's page links each item's name to its product", async ({ page }) => {
  await Stack.fillCart(page.request)
  await Checks.open(page, await Stack.placeOrder(page.request))

  const items = page.getByRole("heading", { level: 2, name: "Items" }).locator("xpath=..")

  await expect(items.getByRole("link", { name: "Diamond Sword", exact: true })).toHaveAttribute("href", `/products/${Stack.PRODUCT_SLUG}`)
})

test("opening a page by a click or a key moves focus to its heading, which shows no focus ring", async ({ page }) => {
  const heading = page.getByRole("heading", { level: 1, name: "All products" })

  for (const open of ["click", "Enter"] as const) {
    await Checks.open(page, "/")
    const link = page.getByRole("link", { name: "Browse all products" })
    await (open === "click" ? link.click() : link.press(open))

    await expect(heading, open).toBeFocused()
    expect(await Checks.outlineOf(heading), open).toBe("none")
  }
})

test("a page loaded afresh opens at the top, and a reload and Back return to where a page was scrolled", async ({ page }) => {
  const readScroll = (): Promise<number> => page.evaluate(() => window.scrollY)
  const scrollTo = async (top: number): Promise<void> => {
    await page.evaluate((y) => window.scrollTo(0, y), top)
    await expect.poll(readScroll).toBe(top)
  }
  // Short, so every page here scrolls further than the positions below.
  await page.setViewportSize({ width: 1280, height: 500 })

  await Checks.open(page, "/terms")
  await scrollTo(400)
  // As an address typed into the same tab: a document load of its own.
  await Checks.open(page, "/privacy")
  expect(await readScroll()).toBe(0)

  await scrollTo(300)
  await page.reload({ waitUntil: "load" })
  await expect.poll(readScroll).toBe(300)

  // A click that does not scroll the link into view first, which would move the place Back returns to.
  await page.getByRole("contentinfo").getByRole("link", { name: "About us" }).dispatchEvent("click")
  await expect(page).toHaveURL(/\/about$/)
  await expect.poll(readScroll).toBe(0)
  await page.goBack()
  await expect.poll(readScroll).toBe(300)
})

test("another page of results or of reviews opens at its heading, which takes focus", async ({ page, request }) => {
  await Checks.open(page, "/shop")
  await page.getByRole("navigation", { name: "Result pages" }).getByRole("button", { name: "Next" }).click()

  const results = page.locator("#results-heading")
  await expect(results).toContainText("page 2 of")
  await expect(results).toBeFocused()
  expect((await Checks.boxOf(results)).y).toBeGreaterThanOrEqual(0)
  expect((await Checks.boxOf(results)).y).toBeLessThan(200)

  // The most reviewed product of the first page of the shop has more than one page of reviews, ten to a page.
  const listed = (await (await request.get("/api/v1/products?perPage=60")).json()) as Readonly<{
    items: readonly Readonly<{ slug: string; rating: Readonly<{ count: number }> }>[]
  }>
  const [most] = listed.items.toSorted((a, b) => b.rating.count - a.rating.count)
  expect(most?.rating.count ?? 0, "reviews of the most reviewed product").toBeGreaterThan(10)
  await Checks.open(page, `/products/${most?.slug ?? Stack.PRODUCT_SLUG}`)
  const pages = page.getByRole("navigation", { name: "Review pages" })
  await pages.getByRole("button", { name: "Next" }).click()

  const reviews = page.getByRole("heading", { level: 2, name: "Reviews" })
  await expect(pages).toContainText("Page 2 of")
  await expect(reviews).toBeFocused()
  expect((await Checks.boxOf(reviews)).y).toBeGreaterThanOrEqual(0)
  expect((await Checks.boxOf(reviews)).y).toBeLessThan(200)
})

test("an address outside the route list answers 404 with the shop's page, and a page inside it 200", async ({ request }) => {
  const missing = await request.get("/no-such-page")
  const present = await request.get("/about")

  expect(missing.status()).toBe(404)
  expect(await missing.text()).toContain('<div id="root">')
  expect(present.status()).toBe(200)
})

test("an unknown product or category answers 404 with the shop's page, and a known one 200", async ({ request }) => {
  for (const path of ["/products/no-such-product", "/categories/no-such-category"]) {
    const missing = await request.get(path)

    expect(missing.status(), path).toBe(404)
    expect(await missing.text(), path).toContain('<div id="root">')
  }

  for (const path of [`/products/${Stack.PRODUCT_SLUG}`, "/categories/minecraft"]) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
})

test("an unknown product shows the not-found page and asks search engines to skip it", async ({ page }) => {
  await Checks.open(page, "/products/no-such-product")

  await expect(page.getByRole("heading", { level: 1, name: "Product not found" })).toBeVisible()
  expect((await Checks.facts(page)).robots).toBe("noindex")
})

test("robots.txt and the sitemap are served at the site's root", async ({ request }) => {
  const robots = await request.get("/robots.txt")
  const sitemap = await request.get("/sitemap.xml")

  expect(await robots.text()).toContain("Disallow: /admin")
  expect(await sitemap.text()).toContain(`/products/${Stack.PRODUCT_SLUG}</loc>`)
})
