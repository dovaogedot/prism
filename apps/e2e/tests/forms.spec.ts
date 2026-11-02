/**
 * Messages that depend on more than one field: each follows every field it
 * depends on, so a fixed form shows no message left over from before.
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
