/**
 * The shop on a phone.
 *
 * Below the width the filters stand beside the results at, the header keeps
 * the wordmark, the account links and a button that opens a drawer, and the
 * drawer holds the switches and, on the catalog, the filters. What these cover
 * is that nothing in the header wraps or runs past its edge, that the switches
 * and the filters are in the drawer rather than on the page, and that a filter
 * set from the drawer narrows the shelf.
 */

import { devices, expect, test, type Page } from "@playwright/test";

const PHONE = devices["Pixel 7"];

test.use({
  viewport: PHONE.viewport,
  deviceScaleFactor: PHONE.deviceScaleFactor,
  isMobile: PHONE.isMobile,
  hasTouch: PHONE.hasTouch,
  userAgent: PHONE.userAgent,
});

/**
 * The narrowest page the header is held to, in CSS pixels.
 *
 * The narrowest width a current phone reports, where the header is at its
 * most crowded.
 */
const NARROWEST = 360;

const results = (page: Page) => page.getByRole("region", { name: "Results" });

const drawer = (page: Page) => page.getByRole("dialog", { name: "Menu" });

/** Waits for the grid, so nothing below is read off a skeleton. */
const ready = async (page: Page): Promise<void> => {
  await expect(results(page).getByRole("article").first()).toBeVisible();
};

/**
 * How many lines each piece of text on show in the header runs to, and how
 * far the header's row runs past its own width, in CSS pixels.
 */
const headerLayout = (page: Page) =>
  page.getByRole("banner").evaluate((header) => {
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    const texts: { text: string; lines: number }[] = [];

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      const range = document.createRange();

      range.selectNodeContents(node);

      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);

      if (text !== "" && rects.length > 0) {
        texts.push({ text, lines: new Set(rects.map((rect) => Math.round(rect.top))).size });
      }
    }

    const row = header.firstElementChild;

    return { texts, overflow: row === null ? 0 : row.scrollWidth - row.clientWidth };
  });

test("keeps every word in the header on one line, inside the header", async ({ page }) => {
  for (const width of [NARROWEST, PHONE.viewport.width]) {
    await page.setViewportSize({ width, height: PHONE.viewport.height });
    await page.goto("/");

    const { texts, overflow } = await headerLayout(page);

    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((entry) => entry.lines > 1)).toEqual([]);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("keeps the switches out of the header, and in the drawer", async ({ page }) => {
  await page.goto("/");

  const header = page.getByRole("banner");

  await expect(header.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);

  await header.getByRole("button", { name: "Open menu" }).tap();

  await expect(
    drawer(page).getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
  ).toBeVisible();
  await expect(
    drawer(page).getByRole("button", { name: /^Switch to (live|still) pictures$/ }),
  ).toBeVisible();
});

test("keeps the filters in the drawer, and narrows the shelf from there", async ({ page }) => {
  await page.goto("/");
  await ready(page);

  await expect(page.getByRole("radio", { name: /^Finishers/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Filters", exact: true }).tap();

  // Clicked rather than checked: the radio is held by the URL, so it turns on
  // once the shelf has moved rather than during the click itself.
  const finishers = drawer(page).getByRole("radio", { name: /^Finishers/ });

  await finishers.click();

  await expect(finishers).toBeChecked();
  await expect(page).toHaveURL(/category=finisher/);

  await drawer(page).getByRole("button", { name: "Close menu" }).tap();

  await expect(drawer(page)).toBeHidden();
  await ready(page);
});
