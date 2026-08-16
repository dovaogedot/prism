/**
 * Where the auth routes send you, in a real browser.
 *
 * This is the kind of thing only an end-to-end test can hold down: the answer
 * depends on a redirect and a form navigation both landing in the same tick,
 * which no unit test of a component can reproduce.
 *
 * The signed-in half shares one browser context and runs serially, for two
 * reasons that are both the application working correctly. `/auth/*` is rate
 * limited to ten requests a minute per address, so a sign-in per test would
 * spend that budget on itself. And refresh tokens are single-use: handing the
 * same saved cookie to several parallel contexts is a replay, and replay
 * detection revokes the whole session — which is precisely what it is for.
 */

import { expect, test, type Page } from "@playwright/test";
import { SHOPPER } from "../support/accounts.ts";

/** Pages that only make sense when signed out. */
const GUEST_ONLY = ["/login", "/login/2fa", "/register"] as const;

/** Password recovery, which a signed-in visitor may legitimately still need. */
const ALWAYS_OPEN = ["/forgot-password", "/reset-password"] as const;

const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(SHOPPER.email);
  await page.getByLabel("Password").fill(SHOPPER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The header swapping to the address is the session actually landing, rather
  // than the request merely having been sent.
  await expect(page.getByRole("link", { name: SHOPPER.email })).toBeVisible();
};

test.describe("signed out", () => {
  for (const path of [...GUEST_ONLY, ...ALWAYS_OPEN]) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(path);
    });
  }

  test("signing in lands on the catalog, not the account page", async ({ page }) => {
    // The guard reads the session once at mount for exactly this reason. If it
    // subscribed instead, the sign-in it just witnessed would redirect the
    // visitor to /account and quietly overrule the page.
    await signIn(page);
    await expect(page).toHaveURL("/");
  });
});

test.describe("signed in", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  for (const path of GUEST_ONLY) {
    test(`${path} redirects to the account page`, async () => {
      await page.goto(path);
      await expect(page).toHaveURL("/account");
    });
  }

  for (const path of ALWAYS_OPEN) {
    test(`${path} stays reachable`, async () => {
      // Holding a session and having forgotten your password are not mutually
      // exclusive, and the account page cannot help: changing a password in
      // place asks for the current one.
      await page.goto(path);
      await expect(page).toHaveURL(path);
    });
  }

  test("Back does not bounce off a redirected page", async () => {
    await page.goto("/");
    await page.goto("/login");
    await expect(page).toHaveURL("/account");

    // The redirect replaced the history entry, so Back reaches the catalog
    // rather than /login, which would only redirect again.
    await page.goBack();
    await expect(page).toHaveURL("/");
  });
});
