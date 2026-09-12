/**
 * How a stage sits in the page around it.
 *
 * A stage is a room drawn into a card, and the card is on the page. A room far
 * lighter or darker than the page reads as a box cut into it rather than as the
 * product standing in the shop, so every room's far wall is held near the
 * page's own lightness, under both themes and on every shelf that draws one.
 */

import { expect, test } from "@playwright/test";
import { drawn, pageLightness, pretendGpu, topBands } from "../support/stages.ts";

/**
 * Room to draw in.
 *
 * Every test here waits on a shelf of pictures that a headless browser
 * rasterizes in software. That is slower than the default allows for, and slow
 * is not the same as wrong.
 */
test.describe.configure({ timeout: 120_000 });

/**
 * How far the top of a stage may sit from the page's lightness, in points of
 * lightness, under each theme.
 *
 * Wider at night: a glowing finisher's spill is light in the air of a dark
 * room, and the hardest glow on its shelf lifts the top of its own stage.
 */
const PAGE_GAP = { light: 4, dark: 10 };

/** Every shelf that draws a room, by what it shows. */
const SHELVES = [
  ["colors", "/?category=color"],
  ["grains", "/?category=finisher&finish=roughness"],
  ["coatings", "/?category=finisher&finish=iridescent"],
  ["glows", "/?category=finisher&finish=fluorescent"],
] as const;

test.beforeEach(async ({ page }) => {
  await pretendGpu(page);
});

for (const scheme of ["light", "dark"] as const) {
  for (const [what, url] of SHELVES) {
    test(`sets ${what} against a wall near the page's own lightness, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await drawn(page);

      const behind = await pageLightness(page);
      const tops = await topBands(page);

      expect(tops.length).toBeGreaterThan(0);
      for (const top of tops) {
        expect(Math.abs(top - behind)).toBeLessThanOrEqual(PAGE_GAP[scheme]);
      }
    });
  }
}
