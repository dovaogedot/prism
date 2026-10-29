/**
 * REQUIREMENTS_3.md: "Error page (404) includes catch-all error message."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"

test("an address that is no page answers 404 with the shop's own not-found page", async ({ page }) => {
  const response = await Checks.open(page, "/no-such-page/at-all")

  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible()
  await expect(page.getByText("It may have moved, or the link may be mistyped.")).toBeVisible()
  // A way on from any wrong address: a search, and the way home.
  await expect(page.getByRole("main").getByRole("search")).toBeVisible()
})
