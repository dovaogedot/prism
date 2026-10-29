/**
 * REQUIREMENTS_1.md: "Access tokens are stored in memory."
 */

import { expect, test } from "@playwright/test"
import { Checks } from "../../apps/e2e/support/checks.ts"
import { Stack } from "../../apps/e2e/support/stack.ts"

test("signing in keeps the access token out of every storage a script can read, and a reload signs in again through the refresh cookie", async ({
  context,
  page,
}) => {
  const email = await Stack.registerCustomer(context.request, "memory")
  // Registering signed the browser in; this one signs in through the page.
  await context.clearCookies()

  await Checks.open(page, "/login")
  await page.getByLabel("Email address").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(Stack.PASSWORD)
  const [signIn] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/login")),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ])
  const { grant } = (await signIn.json()) as { grant: { accessToken: string } }
  const account = page.getByRole("button", { name: `Account, ${email}` })
  await expect(account).toBeVisible()

  const readable = await page.evaluate(() => ({
    localStorage: JSON.stringify(Object.entries(localStorage)),
    sessionStorage: JSON.stringify(Object.entries(sessionStorage)),
    cookies: document.cookie,
  }))
  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === "prism_refresh")

  expect(grant.accessToken.split(".")).toHaveLength(3)
  expect(readable.localStorage).not.toContain(grant.accessToken)
  expect(readable.sessionStorage).not.toContain(grant.accessToken)
  expect(readable.cookies).not.toContain(grant.accessToken)
  // What survives a reload is the refresh token, in a cookie no script can read.
  expect(refreshCookie?.httpOnly).toBe(true)
  expect(readable.cookies).not.toContain("prism_refresh")

  const [refresh] = await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/refresh")), page.reload()])

  expect(refresh.status()).toBe(200)
  await expect(account).toBeVisible()
})
