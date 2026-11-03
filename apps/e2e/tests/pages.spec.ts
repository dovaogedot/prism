/**
 * Every storefront page, in both themes: what axe-core finds, one h1, a
 * title under 60 characters and a description of 155 to 160, no sideways
 * spill at any of the widths, one edge on every control at 2:1 against the
 * page, nothing the Content-Security-Policy refused,
 * no request of the shop's own refused but the ones a page expects, and no
 * error of the shop's own in the console. Google's CAPTCHA script gets a
 * stand-in on every page check, and one test loads the real one.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../support/checks.ts"
import { Stack } from "../support/stack.ts"

/**
 * A page to check: its address, the status it answers with, what it needs
 * set up first, and the requests of its own it expects refused, each as
 * `<status> <method> <path>`.
 */
type Entry = Readonly<{
  name: string
  path: string
  status?: number
  isSignedIn?: boolean
  hasCart?: boolean
  refused?: readonly string[]
}>

const entries: readonly Entry[] = [
  { name: "home", path: "/" },
  { name: "shop", path: "/shop" },
  { name: "category", path: "/categories/minecraft" },
  { name: "search with a typo", path: "/search?q=diamnd%20sword" },
  { name: "shop as a list", path: "/shop?view=list" },
  { name: "product", path: `/products/${Stack.PRODUCT_SLUG}` },
  { name: "cart", path: "/cart", hasCart: true },
  { name: "checkout", path: "/checkout", hasCart: true },
  { name: "about", path: "/about" },
  { name: "faq", path: "/faq" },
  { name: "contact", path: "/contact" },
  { name: "terms", path: "/terms" },
  { name: "privacy", path: "/privacy" },
  { name: "sign in", path: "/login" },
  { name: "register", path: "/register" },
  { name: "forgot password", path: "/forgot-password" },
  { name: "not found", path: "/no-such-page", status: 404, refused: ["404 GET /no-such-page"] },
  {
    name: "unknown product",
    path: "/products/no-such-product",
    refused: ["404 GET /api/v1/products/no-such-product", "404 GET /api/v1/products/no-such-product/reviews"],
  },
  { name: "account", path: "/account", isSignedIn: true },
  { name: "addresses", path: "/account/addresses", isSignedIn: true },
  { name: "orders", path: "/account/orders", isSignedIn: true },
]

for (const theme of Checks.THEMES) {
  test.describe(`in the ${theme} theme`, () => {
    for (const entry of entries) {
      test(entry.name, async ({ context, page, baseURL }) => {
        const origin = new URL(baseURL ?? "https://localhost:3200").origin
        await Checks.useTheme(context, theme)
        await Checks.watchCsp(context)
        await Checks.stubCaptcha(context)
        if (entry.isSignedIn === true) {
          await Stack.registerCustomer(context.request, "pages")
        }
        if (entry.hasCart === true) {
          await Stack.fillCart(context.request)
        }

        const errors: string[] = []
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("console", (message) => {
          if (message.type() === "error" && Checks.isOwnError(message, origin)) errors.push(message.text())
        })

        // A guest's page asks to refresh a session it does not have, and is refused by design.
        const expected = [...(entry.isSignedIn === true ? [] : ["401 POST /api/v1/auth/refresh"]), ...(entry.refused ?? [])]
        const refused: string[] = []
        page.on("response", (answer) => {
          const url = new URL(answer.url())
          if (url.origin === origin && answer.status() >= 400)
            refused.push(`${answer.status()} ${answer.request().method()} ${url.pathname}`)
        })

        const response = await Checks.open(page, entry.path)
        const facts = await Checks.facts(page)

        expect(response?.status()).toBe(entry.status ?? 200)
        expect(facts.headings, "one h1").toBe(1)
        expect(facts.title.length, facts.title).toBeLessThan(60)
        expect(facts.title).toMatch(/ \| Prism$/)
        expect(facts.descriptions).toHaveLength(1)
        expect(facts.descriptions[0]?.length ?? 0, facts.descriptions[0]).toBeGreaterThanOrEqual(155)
        expect(facts.descriptions[0]?.length ?? 0, facts.descriptions[0]).toBeLessThanOrEqual(160)
        expect(await Checks.axe(page)).toEqual([])
        expect(await Checks.findControlEdgeFaults(page)).toEqual([])
        expect(await Checks.overflowAt(page, Checks.WIDTHS)).toEqual(Object.fromEntries(Checks.WIDTHS.map((width) => [width, 0])))
        expect(await Checks.cspViolations(page)).toEqual([])
        expect(refused.filter((request) => !expected.includes(request))).toEqual([])
        expect(errors).toEqual([])
      })
    }
  })
}

// The one check that loads Google's real CAPTCHA: the page tests answer its script with a stand-in.
test("the Content-Security-Policy admits Google's live CAPTCHA", async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL ?? "https://localhost:3200").origin
  await Checks.watchCsp(context)
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && Checks.isOwnError(message, origin)) errors.push(message.text())
  })

  await Checks.open(page, "/register")
  await page.locator(Checks.CAPTCHA_FRAMES).first().waitFor({ state: "attached" })
  // Solving it, which Google's test key always lets pass, sends the page's own requests to Google too.
  const checkbox = page.frameLocator('iframe[src*="google.com/recaptcha/api2/anchor"]').locator("#recaptcha-anchor")
  await checkbox.click()
  await expect(checkbox).toHaveAttribute("aria-checked", "true")
  await page.waitForLoadState("networkidle")

  expect(await Checks.cspViolations(page)).toEqual([])
  expect(errors).toEqual([])
})

test("each indexed page has a title and a description of its own", async ({ page }) => {
  const seen: { title: string; description: string; path: string }[] = []

  // The list view is the shop's own page, filed under /shop; an unknown product is the not-found page.
  const own = entries.filter(
    (candidate) =>
      candidate.isSignedIn !== true && candidate.hasCart !== true && !["shop as a list", "unknown product"].includes(candidate.name),
  )

  for (const entry of own) {
    await Checks.open(page, entry.path)
    const facts = await Checks.facts(page)
    seen.push({ title: facts.title, description: facts.descriptions[0] ?? "", path: entry.path })
  }

  const repeated = (key: "title" | "description") =>
    seen
      .filter((entry, index) => seen.findIndex((other) => other[key] === entry[key]) !== index)
      .map((entry) => `${entry.path}: ${entry[key]}`)

  expect(repeated("title")).toEqual([])
  expect(repeated("description")).toEqual([])
})

test("search engines are asked to skip the personal pages and the results", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "robots")

  for (const path of ["/cart", "/checkout", "/account", "/account/orders", "/search?q=sword", "/login"]) {
    await Checks.open(page, path)
    expect((await Checks.facts(page)).robots, path).toBe("noindex")
  }

  for (const path of ["/", "/shop", "/categories/minecraft", `/products/${Stack.PRODUCT_SLUG}`, "/about"]) {
    await Checks.open(page, path)
    const facts = await Checks.facts(page)
    expect(facts.robots, path).toBe("")
    expect(facts.canonical, path).toBe(new URL(path, page.url()).toString())
  }
})
