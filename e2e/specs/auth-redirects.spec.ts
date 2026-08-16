/**
 * Where the auth routes send you, in a real browser.
 *
 * This is the kind of thing only an end-to-end test can hold down: the answer
 * depends on a redirect and a form navigation both landing in the same tick,
 * which no unit test of a component can reproduce.
 */

import { expect, test, type Page } from "@playwright/test";

const SHOPPER = { email: "shopper@prism.test", password: "colors are not paint" };

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
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("signing in lands on the catalog, not the account page", async ({ page }) => {
    // The guard reads the session once at mount for exactly this reason. If it
    // subscribed instead, the sign-in it just witnessed would redirect the
    // visitor to /account and quietly overrule the page.
    await expect(page).toHaveURL("/");
  });

  for (const path of GUEST_ONLY) {
    test(`${path} redirects to the account page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL("/account");
    });
  }

  for (const path of ALWAYS_OPEN) {
    test(`${path} stays reachable`, async ({ page }) => {
      // Holding a session and having forgotten your password are not mutually
      // exclusive, and the account page cannot help: changing a password in
      // place asks for the current one.
      await page.goto(path);
      await expect(page).toHaveURL(path);
    });
  }

  test("Back does not bounce off a redirected page", async ({ page }) => {
    await page.goto("/");
    await page.goto("/login");
    await expect(page).toHaveURL("/account");

    // The redirect replaced the history entry, so Back reaches the catalog
    // rather than /login, which would only redirect again.
    await page.goBack();
    await expect(page).toHaveURL("/");
  });
});
