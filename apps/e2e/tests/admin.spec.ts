/**
 * The admin: its gate, which keeps customers out and makes staff set up a
 * second factor before anything opens, and every admin page in both themes
 * held to the same checks as the storefront.
 *
 * The admin signs in once for the whole file: a TOTP code works once, and
 * the refresh cookie rotates with every use, so the pages share one session.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Checks } from "../support/checks.ts";
import { Stack, Totp } from "../support/stack.ts";

test.describe.configure({ mode: "serial" });

const pages = [
  { name: "dashboard", path: "/admin", heading: "Dashboard" },
  { name: "orders", path: "/admin/orders", heading: "Orders" },
  { name: "products", path: "/admin/products", heading: "Products" },
  { name: "new product", path: "/admin/products/new", heading: "New product" },
  { name: "categories", path: "/admin/categories", heading: "Categories" },
  { name: "brands", path: "/admin/brands", heading: "Brands" },
  { name: "import", path: "/admin/import", heading: "Import products" },
  { name: "reviews", path: "/admin/reviews", heading: "Reviews" },
  { name: "delivery options", path: "/admin/shipping", heading: "Delivery options" },
  { name: "accounts", path: "/admin/users?staff=true", heading: "Accounts" },
  { name: "audit log", path: "/admin/audit", heading: "Audit log" },
];

let admin: BrowserContext;
let adminPage: Page;
let adminToken: string;

test.beforeAll(async ({ browser }, info) => {
  const { baseURL } = info.project.use;
  admin = await browser.newContext({ ...(baseURL === undefined ? {} : { baseURL }), ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  await Checks.watchCsp(admin);
  adminToken = await Stack.signInAdmin(admin.request);
  adminPage = await admin.newPage();
});

test.afterAll(async () => {
  await admin.close();
});

test("a customer is told the admin is for staff", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "customer");

  await Checks.open(page, "/admin");

  await expect(page.getByRole("heading", { level: 1, name: "Staff only" })).toBeVisible();
});

test("a guest is sent to sign in, and comes back to the admin afterwards", async ({ page }) => {
  await Checks.open(page, "/admin/orders");

  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Forders$/);
});

test("new staff set up a second factor before the admin opens, and see only their sections", async ({ context, page }) => {
  const email = await Stack.registerCustomer(context.request, "moderator");
  await Stack.grantRoles(admin.request, adminToken, email, ["moderator"]);

  await Checks.open(page, "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Set up two-factor authentication" })).toBeVisible();
  expect(await Checks.axe(page)).toEqual([]);

  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
  const uri = await page.locator("code").filter({ hasText: "otpauth://" }).innerText();
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  await page.getByLabel("Code from the app").fill(Totp.code(secret, 0));
  await page.getByRole("button", { name: "Turn it on" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link")).toHaveText(["Dashboard", "Reviews"]);
});

for (const theme of Checks.THEMES) {
  for (const entry of pages) {
    test(`${entry.name} in the ${theme} theme`, async () => {
      // The theme is stored the way the switch stores it, then the page is opened afresh.
      await Checks.open(adminPage, "/admin");
      await adminPage.evaluate((chosen) => localStorage.setItem("prism-theme", chosen), theme);
      const errors: string[] = [];
      adminPage.removeAllListeners("pageerror");
      adminPage.on("pageerror", (error) => errors.push(error.message));

      await adminPage.setViewportSize({ width: 1280, height: 900 });
      await Checks.open(adminPage, entry.path);
      const facts = await Checks.facts(adminPage);

      await expect(adminPage.getByRole("heading", { level: 1, name: entry.heading })).toBeVisible();
      expect(facts.headings).toBe(1);
      expect(facts.title.length, facts.title).toBeLessThanOrEqual(60);
      expect(facts.descriptions[0]?.length ?? 0).toBeGreaterThanOrEqual(155);
      expect(facts.descriptions[0]?.length ?? 0).toBeLessThanOrEqual(160);
      expect(facts.robots).toBe("noindex");
      expect(await Checks.axe(adminPage)).toEqual([]);
      expect(await Checks.overflowAt(adminPage, Checks.WIDTHS)).toEqual(Object.fromEntries(Checks.WIDTHS.map((width) => [width, 0])));
      expect(await Checks.cspViolations(adminPage)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("the accounts search's Find button sits in the email field's row, after the field", async () => {
  await Checks.open(adminPage, "/admin/users");
  const field = await Checks.boxOf(adminPage.getByLabel("Exact email"));
  const find = await Checks.boxOf(adminPage.getByRole("button", { name: "Find" }));

  expect(find.x).toBeGreaterThanOrEqual(field.x + field.width);
  expect(Checks.middleGap(field, find)).toBeLessThanOrEqual(Checks.TOLERANCE);
});

test("deleting asks first, and cancelling deletes nothing", async () => {
  // A name of its own, so a run against a stack an earlier run used finds no brand of that name.
  const name = `Asked First ${Date.now()}`;
  const deleteButton = adminPage.getByRole("button", { name: `Delete ${name}` });

  await Checks.open(adminPage, "/admin/brands");
  await adminPage.getByRole("button", { name: "New brand" }).click();
  await adminPage.getByRole("dialog").getByLabel("Name").fill(name);
  await adminPage.getByRole("dialog").getByRole("button", { name: "Create brand" }).click();
  await expect(adminPage.getByRole("dialog", { name: "New brand" })).toBeHidden();
  await expect(deleteButton).toBeVisible();

  await deleteButton.click();
  const confirm = adminPage.getByRole("dialog", { name: `Delete ${name}?` });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await adminPage.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await adminPage.getByRole("dialog", { name: `Delete ${name}?` }).getByRole("button", { name: "Delete brand" }).click();
  await expect(deleteButton).toBeHidden();
});
