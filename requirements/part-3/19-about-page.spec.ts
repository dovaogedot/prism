/**
 * REQUIREMENTS_3.md: "About page includes companies information, mission,
 * team and links to social media."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"

test("the about page says who the company is, what it is for, who works there, and where to follow it", async ({ page }) => {
  await Checks.open(page, "/")
  await page.getByRole("contentinfo").getByRole("link", { name: "About us" }).click()

  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("About Prism")
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["What we do", "What we care about", "The team", "Find us"])

  // The company, and its mission.
  await expect(main).toContainText("Prism sells collectible items from Minecraft, Balatro and The Binding of Isaac")
  await expect(main).toContainText("We started in Tallinn")
  await expect(main.getByText("Honest listings.")).toBeVisible()

  // The team: each person with a name and a role.
  const team = main.getByRole("heading", { level: 2, name: "The team" }).locator("xpath=following-sibling::ul[1]").getByRole("listitem")
  expect(await team.count()).toBeGreaterThanOrEqual(3)

  for (const person of await team.all()) {
    await expect(person.getByRole("heading", { level: 3 })).not.toBeEmpty()
    await expect(person.locator("p").first()).not.toBeEmpty()
  }

  // The social media links.
  for (const [name, host] of [
    ["Instagram", "www.instagram.com"],
    ["X", "x.com"],
    ["YouTube", "www.youtube.com"],
    ["GitHub", "github.com"],
  ] as const) {
    const href = await main.getByRole("link", { name, exact: true }).getAttribute("href")

    expect(new URL(href ?? "", page.url()).host, name).toBe(host)
  }
})
