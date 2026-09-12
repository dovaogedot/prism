/**
 * The shop on a phone.
 *
 * Below the width the filters stand beside the results at, the header keeps
 * the wordmark, the account links and a button that opens a drawer, and the
 * drawer holds the switches and, on the catalog, the filters. A finger drawn
 * across a picture turns it. What these cover is that nothing in the header
 * wraps or runs past its edge, that the switches and the filters are in the
 * drawer rather than on the page, that a filter set from the drawer narrows
 * the shelf, and that a finger turns a picture and still scrolls the page.
 */

import { devices, expect, test, type Page } from "@playwright/test";
import { DRAWN, drawn, pretendGpu, signature } from "../support/stages.ts";

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

/** Sends one step of a single finger to the page, at a point in CSS pixels. */
type Finger = (kind: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => Promise<void>;

/**
 * A finger on the page.
 *
 * Driven through the browser's input rather than through script, so the page
 * receives what a phone sends it: touch and pointer events together, with
 * the browser deciding from the stage's touch action whether a drag is the
 * page's to scroll.
 */
const fingerOn = async (page: Page): Promise<Finger> => {
  const session = await page.context().newCDPSession(page);

  return async (kind, x, y) => {
    await session.send("Input.dispatchTouchEvent", {
      type: kind,
      touchPoints: kind === "touchEnd" ? [] : [{ x, y }],
    });
  };
};

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

test.describe("a phone that can draw", () => {
  test.beforeEach(async ({ page }) => {
    await pretendGpu(page);
  });

  for (const [what, shelf] of [
    ["a color", "/?category=color"],
    ["a finisher's room", "/?category=finisher"],
  ] as const) {
    test(`turns ${what} under a finger drawn sideways, and puts it back when it lifts`, async ({
      page,
    }) => {
      await page.goto(shelf);
      await expect(results(page).getByRole("article").first()).toBeVisible(DRAWN);
      await drawn(page);

      const stage = page.locator("canvas.stage__canvas").first();

      await stage.scrollIntoViewIfNeeded();

      const box = await stage.boundingBox();

      expect(box).not.toBeNull();
      if (box === null) return;

      const resting = await signature(page);
      const finger = await fingerOn(page);
      const y = box.y + box.height / 2;

      expect(resting).not.toBe("");

      await finger("touchStart", box.x + box.width * 0.5, y);
      for (const along of [0.4, 0.3, 0.2, 0.1]) {
        await finger("touchMove", box.x + box.width * along, y);
      }

      await expect.poll(() => signature(page), { timeout: 30_000 }).not.toBe(resting);

      await finger("touchEnd", 0, 0);

      await expect.poll(() => signature(page), { timeout: 30_000 }).toBe(resting);
    });
  }

  test("scrolls the page under a finger drawn up a picture", async ({ page }) => {
    await page.goto("/?category=color");
    await expect(results(page).getByRole("article").first()).toBeVisible(DRAWN);
    await drawn(page);

    const box = await page.locator("canvas.stage__canvas").first().boundingBox();

    expect(box).not.toBeNull();
    if (box === null) return;

    const finger = await fingerOn(page);
    const x = box.x + box.width / 2;
    const before = await page.evaluate(() => window.scrollY);

    await finger("touchStart", x, box.y + box.height * 0.8);
    for (const along of [0.6, 0.4, 0.2]) {
      await finger("touchMove", x, box.y + box.height * along);
    }
    await finger("touchEnd", 0, 0);

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });
});
