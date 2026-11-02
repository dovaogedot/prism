/**
 * When a form speaks: each field is checked when the customer leaves it, then
 * as it is typed in, and a message that depends on more than one field
 * follows every field it depends on, so a fixed form shows nothing left over.
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../support/checks.ts"
import { Stack } from "../support/stack.ts"

test("a postal code's message follows the country it is checked against", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "postal-country")
  await Checks.open(page, "/account/addresses")
  await page.getByRole("button", { name: "Add an address" }).click()

  for (const [label, value] of [
    ["Name of the address", "Home"],
    ["Full name", "Mari Maasikas"],
    ["Phone", "+372 5123 4567"],
    ["Street and house number", "Narva mnt 7"],
    ["City", "Tallinn"],
    ["Postal code", "10117"],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }
  await page.getByLabel("Country", { exact: true }).selectOption({ label: "Netherlands" })
  await page.getByRole("button", { name: "Add address" }).click()
  await expect(page.getByText("Enter a postal code like 1012 AB.")).toBeVisible()

  await page.getByLabel("Country", { exact: true }).selectOption({ label: "Estonia" })

  await expect(page.getByText(/Enter a postal code like/)).toHaveCount(0)
  await expect(page.getByLabel("Postal code", { exact: true })).toHaveAttribute("aria-invalid", "false")
})

test("a password confirmation's message follows the password it has to match", async ({ page }) => {
  await Checks.stubCaptcha(page.context())
  await Checks.open(page, "/register")

  await page.getByLabel("Email address", { exact: true }).fill("confirm@example.com")
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple")
  await page.getByLabel("Confirm password", { exact: true }).fill("correct horse battery stapler")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("The two passwords do not match.")).toBeVisible()

  await page.getByLabel("Password", { exact: true }).fill("correct horse battery stapler")

  await expect(page.getByText("The two passwords do not match.")).toHaveCount(0)
})

test("a field is checked when it is left, clears as it is fixed, and a field not reached yet shows nothing", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "checked-on-leaving")
  await Checks.open(page, "/account/addresses")
  await page.getByRole("button", { name: "Add an address" }).click()
  const street = page.getByLabel("Street and house number", { exact: true })
  const message = page.getByText("Enter the street name as well as the house number.")

  await street.fill("233")
  await expect(message).toHaveCount(0)
  await street.blur()

  await expect(message).toBeVisible()
  await expect(page.getByLabel("City", { exact: true })).toHaveAttribute("aria-invalid", "false")

  await street.fill("Narva mnt 7")
  await expect(message).toHaveCount(0)
})

test("leaving the password does not mark a confirmation not filled in yet", async ({ page }) => {
  await Checks.stubCaptcha(page.context())
  await Checks.open(page, "/register")
  const password = page.getByLabel("Password", { exact: true })

  await password.fill("correct horse battery staple")
  await password.blur()

  await expect(page.getByLabel("Confirm password", { exact: true })).toHaveAttribute("aria-invalid", "false")
})
