/**
 * What a visitor does with a keyboard and a screen reader in mind: the skip
 * link, the header's controls, the search box, the cart preview, and where
 * focus lands when a page changes. And the answers a crawler gets: a real
 * 404 for an address outside the route list.
 */

import { expect, test } from "@playwright/test";
import { Checks } from "../support/checks.ts";
import { Stack } from "../support/stack.ts";

test("the skip link is the first thing Tab reaches, and leads to the main content", async ({ page }) => {
  await Checks.open(page, "/");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("Tab reaches the search box, the shop menu, the cart and signing in, in that order", async ({ page }) => {
  await Checks.open(page, "/");
  const reached: string[] = [];

  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab");
    reached.push(
      await page.evaluate(() => {
        const focused = document.activeElement;
        const label = focused instanceof HTMLInputElement ? focused.labels?.[0]?.textContent : undefined;
        return (focused?.getAttribute("aria-label") ?? label ?? focused?.textContent ?? "").trim();
      }),
    );
  }

  const order = ["Shop", "Search products", "Cart, empty", "Sign in"].map((name) => reached.findIndex((label) => label.startsWith(name)));
  expect(order.every((index) => index >= 0), reached.join(" / ")).toBe(true);
  expect(order).toEqual([...order].toSorted((a, b) => a - b));
});

test("the search box suggests products, and the keyboard opens one", async ({ page }) => {
  await Checks.open(page, "/");
  const box = page.getByRole("combobox", { name: "Search products" });

  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await page.keyboard.type("diamond sw");
  await expect(page.getByRole("option", { name: /Diamond Sword/ }).first()).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/products\/diamond-sword$/);
  await expect(page.getByRole("heading", { level: 1, name: "Diamond Sword" })).toBeFocused();
});

test("Escape closes the suggestions, and a second Escape clears the box", async ({ page }) => {
  await Checks.open(page, "/");
  const box = page.getByRole("combobox", { name: "Search products" });

  await box.fill("sword");
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(box).toHaveValue("");
});

test("Enter on typed text searches, and a misspelling shows similar names and says so", async ({ page }) => {
  await Checks.open(page, "/");

  await page.getByRole("combobox", { name: "Search products" }).fill("diamnd sword");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=diamnd%20sword$/);
  await expect(page.getByRole("status").filter({ hasText: 'No exact matches for "diamnd sword". Showing similar names.' })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Diamond Sword" })).toBeVisible();
});

test("adding to the cart opens its preview, and Escape closes it and gives focus back", async ({ page }) => {
  await Checks.open(page, `/products/${Stack.PRODUCT_SLUG}`);

  await page.getByRole("button", { name: "Add to cart" }).click();
  const preview = page.getByRole("region", { name: "Cart preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Diamond Sword");
  await expect(preview.getByRole("link", { name: "Checkout" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();

  const cart = page.getByRole("button", { name: /^Cart, / });
  await cart.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cart).toBeFocused();
});

test("opening a page moves focus to its heading", async ({ page }) => {
  await Checks.open(page, "/");

  await page.getByRole("link", { name: "Browse all products" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "All products" })).toBeFocused();
});

test("an address outside the route list answers 404 with the shop's page, and a page inside it 200", async ({ request }) => {
  const missing = await request.get("/no-such-page");
  const present = await request.get("/about");

  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('<div id="root">');
  expect(present.status()).toBe(200);
});

test("an unknown product shows the not-found page and asks search engines to skip it", async ({ page }) => {
  await Checks.open(page, "/products/no-such-product");

  await expect(page.getByRole("heading", { level: 1, name: "Product not found" })).toBeVisible();
  expect((await Checks.facts(page)).robots).toBe("noindex");
});

test("robots.txt and the sitemap are served at the site's root", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  const sitemap = await request.get("/sitemap.xml");

  expect(await robots.text()).toContain("Disallow: /admin");
  expect(await sitemap.text()).toContain(`/products/${Stack.PRODUCT_SLUG}</loc>`);
});
