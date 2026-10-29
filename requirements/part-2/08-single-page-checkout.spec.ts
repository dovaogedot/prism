/**
 * REQUIREMENTS_2.md: "The system implements a single-page checkout process."
 *
 * The browser suite's stack simulates payments, so placing the order pays for
 * it with no card form in between.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Storefront } from "./storefront.ts"

test("checkout asks for everything on one page, and placing the order from it leads straight to the order", async ({ context, page }) => {
  const [product] = await Storefront.findProducts(context.request, 1, 10)
  if (product === undefined) throw new Error("No product to buy.")
  await Storefront.addToCart(context.request, product, 1)

  // Every address the page itself goes to, in order.
  const visited: string[] = []
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return
    const path = new URL(frame.url()).pathname
    if (visited.at(-1) !== path) visited.push(path)
  })

  await Checks.open(page, "/checkout")

  for (const section of ["1. Contact", "2. Shipping address", "3. Billing address", "4. Delivery", "5. Payment"]) {
    await expect(page.getByRole("group", { name: section })).toBeVisible()
  }

  await page.getByLabel("Full name").fill("Mari Maasikas")
  await page.getByLabel("Email", { exact: true }).fill("mari@example.com")
  await page.getByLabel("Phone").fill("+372 5123 4567")
  await page.getByLabel("Street and house number").fill("Narva mnt 7")
  await page.getByLabel("City").fill("Tallinn")
  await page.getByLabel("Postal code").fill("10117")
  await page.getByRole("radio", { name: /^Standard/ }).check()
  await page.getByRole("button", { name: "Place order" }).click()

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1&key=[A-Za-z0-9_-]{43}$/)
  await expect(page.getByRole("alert").filter({ hasText: "Thank you, your order is confirmed" })).toBeVisible({ timeout: 30_000 })
  expect(visited).toEqual(["/checkout", new URL(page.url()).pathname])
})
