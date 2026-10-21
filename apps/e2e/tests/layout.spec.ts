/**
 * Layout the eye would check, measured: what is meant to line up does, and
 * pages meant to share a width do, within a pixel of rounding.
 */

import { expect, test } from "@playwright/test";
import { Checks } from "../support/checks.ts";
import { Stack } from "../support/stack.ts";

test("the rating summary centers its figure on the stars and the count, and the stars carry no figures of their own", async ({ page, request }) => {
  const top = (await (await request.get("/api/v1/products?sort=rating&perPage=1")).json()) as Readonly<{ items: readonly Readonly<{ slug: string }>[] }>;
  await Checks.open(page, `/products/${top.items[0]?.slug ?? Stack.PRODUCT_SLUG}`);

  const row = page.getByRole("list", { name: "Reviews by stars" }).locator("xpath=preceding-sibling::div[1]");
  const figure = await Checks.boxOf(row.locator("xpath=./span"));
  const column = row.locator("xpath=./div");
  const stars = await Checks.boxOf(column.locator("xpath=./span"));
  const count = await Checks.boxOf(column.locator("xpath=./p"));

  expect(Checks.middleGap(figure, await Checks.boxOf(column))).toBeLessThanOrEqual(Checks.TOLERANCE);
  expect(Math.abs(stars.x - count.x)).toBeLessThanOrEqual(Checks.TOLERANCE);
  await expect(row).not.toContainText(/\d\.\d \(\d+\)/);
});

test("the two-factor setup puts its button in the code field's row, after the field", async ({ context, page }) => {
  await Stack.registerCustomer(context.request, "two-factor-row");
  await Checks.open(page, "/account");
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();

  const field = await Checks.boxOf(page.getByLabel("Code from the app"));
  const button = await Checks.boxOf(page.getByRole("button", { name: "Turn it on" }));

  expect(button.x).toBeGreaterThanOrEqual(field.x + field.width);
  expect(Checks.middleGap(field, button)).toBeLessThanOrEqual(Checks.TOLERANCE);
});
