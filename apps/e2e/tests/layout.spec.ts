/**
 * Layout the eye would check, measured: what is meant to line up does, and
 * pages meant to share a width do, within a pixel of rounding.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../support/checks.ts"
import { Stack } from "../support/stack.ts"

test("the rating summary centers its figure on the stars and the count, and the stars carry no figures of their own", async ({
  page,
  request,
}) => {
  const top = (await (await request.get("/api/v1/products?sort=rating&perPage=1")).json()) as Readonly<{
    items: readonly Readonly<{ slug: string }>[]
  }>
  await Checks.open(page, `/products/${top.items[0]?.slug ?? Stack.PRODUCT_SLUG}`)

  const row = page.getByRole("list", { name: "Reviews by stars" }).locator("xpath=preceding-sibling::div[1]")
  const figure = await Checks.boxOf(row.locator("xpath=./span"))
  const column = row.locator("xpath=./div")
  const stars = await Checks.boxOf(column.locator("xpath=./span"))
  const count = await Checks.boxOf(column.locator("xpath=./p"))

  expect(Checks.middleGap(figure, await Checks.boxOf(column))).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(Math.abs(stars.x - count.x)).toBeLessThanOrEqual(Checks.TOLERANCE)
  await expect(row).not.toContainText(/\d\.\d \(\d+\)/)
})

test("the profile, addresses and orders pages share one width and the same tabs, and /orders opens the orders tab", async ({
  context,
  page,
}) => {
  await Stack.registerCustomer(context.request, "widths")
  const widths: number[] = []

  for (const path of ["/account", "/account/addresses", "/account/orders"]) {
    await Checks.open(page, path)
    await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link")).toHaveText(["Profile", "Addresses", "Orders"])
    widths.push((await Checks.boxOf(page.getByRole("heading", { level: 1 }).locator("xpath=.."))).width)
  }

  expect(Math.max(...widths) - Math.min(...widths), widths.join(", ")).toBeLessThanOrEqual(Checks.TOLERANCE)

  await Checks.open(page, "/orders?status=delivered")
  await expect(page).toHaveURL(/\/account\/orders\?status=delivered$/)
})

test("the two-factor setup puts its button in the code field's row, after the field", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "two-factor-row")
  await Checks.open(page, "/account")
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click()

  const field = await Checks.boxOf(page.getByLabel("Code from the app"))
  const button = await Checks.boxOf(page.getByRole("button", { name: "Turn it on" }))

  expect(button.x).toBeGreaterThanOrEqual(field.x + field.width)
  expect(Checks.middleGap(field, button)).toBeLessThanOrEqual(Checks.TOLERANCE)
})

test("the quantity stepper beside Add to cart is as tall as the button, and level with it", async ({ page }) => {
  await Checks.open(page, `/products/${Stack.PRODUCT_SLUG}`)

  const button = await Checks.boxOf(page.getByRole("button", { name: "Add to cart" }))
  const stepper = await Checks.boxOf(page.getByRole("spinbutton", { name: /^Quantity of / }).locator("xpath=.."))

  expect(Math.abs(stepper.height - button.height), `${stepper.height} and ${button.height}`).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(Checks.middleGap(stepper, button)).toBeLessThanOrEqual(Checks.TOLERANCE)
})

test("the shop keeps the filter row open, so the first filter moves no result, and ends the row with Clear all filters", async ({
  page,
}) => {
  await Checks.open(page, "/shop")
  const results = page.getByRole("region", { name: / items/ }).getByRole("listitem")
  const before = await Checks.boxOf(results.first())

  await page.getByRole("group", { name: "Brand" }).getByRole("checkbox").first().click()
  const chip = page.getByRole("button", { name: /^Remove / })
  await chip.waitFor()
  await expect(page.getByRole("region", { name: / items/ })).toHaveAttribute("aria-busy", "false")

  const after = await Checks.boxOf(results.first())
  const clearAll = await Checks.boxOf(page.getByRole("button", { name: "Clear all filters" }))
  const list = await Checks.boxOf(
    page
      .getByRole("region", { name: / items/ })
      .getByRole("list")
      .first(),
  )

  expect(Math.abs(after.y - before.y), `${before.y} then ${after.y}`).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(Math.abs(clearAll.x + clearAll.width - (list.x + list.width))).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(Checks.middleGap(clearAll, await Checks.boxOf(chip))).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(await Checks.findControlEdgeFaults(page)).toEqual([])
})

test("a filter group's Clear all sits level with its heading, above the group's first row", async ({ page }) => {
  await Checks.open(page, "/shop")
  const brand = page.getByRole("group", { name: "Brand" })
  await brand.getByRole("checkbox").first().click()

  const clear = await Checks.boxOf(brand.getByRole("button", { name: /^Clear all/ }))
  const heading = await Checks.boxOf(brand.locator("legend"))
  const firstRow = await Checks.boxOf(brand.locator("label").first())

  expect(Checks.middleGap(clear, heading)).toBeLessThanOrEqual(Checks.TOLERANCE)
  expect(clear.y + clear.height).toBeLessThanOrEqual(firstRow.y)
})

test("a phone field puts a space after the country code, takes it away again when deleting, and shows that country's flag inside the field", async ({
  context,
  page,
}) => {
  await Stack.registerCustomer(context.request, "phone-flag")
  await Checks.open(page, "/account")
  const phone = page.getByLabel("Phone", { exact: true })
  const mark = phone.locator("xpath=preceding-sibling::span//*[local-name()='svg']")

  // A handset stands in until the digits name a country.
  await phone.fill("")
  const handset = await mark.innerHTML()

  await phone.pressSequentially("+3725123")
  await expect(phone).toHaveValue("+372 5123")
  await expect.poll(() => mark.innerHTML()).not.toBe(handset)
  const estonia = await mark.innerHTML()

  const field = await Checks.boxOf(phone)
  const flag = await Checks.boxOf(mark)
  expect(flag.x).toBeGreaterThan(field.x)
  expect(flag.x + flag.width).toBeLessThan(field.x + 40)
  expect(Checks.middleGap(flag, field)).toBeLessThanOrEqual(Checks.TOLERANCE)

  // Deleting back to the code leaves no space to delete by hand.
  for (const _ of "5123") await phone.press("Backspace")
  await expect(phone).toHaveValue("+372")
  await phone.press("Backspace")
  await expect(phone).toHaveValue("+37")

  await phone.fill("")
  await phone.pressSequentially("+12124567890")
  await expect(phone).toHaveValue("+1 2124567890")
  await expect.poll(() => mark.innerHTML()).not.toBe(estonia)
})
