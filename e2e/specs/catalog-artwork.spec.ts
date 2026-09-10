/**
 * What a glowing product is allowed to do to the card it is standing on.
 *
 * A fluorescent face is brighter than the display can show, and the spill that
 * says so is the only part of the picture that reaches past the slab. Left
 * unbounded it floods the stage: the background takes the pigment's hue, the
 * slab loses its edge, and a shelf of them is painful to look at. So the spill
 * has a ceiling, and this is where the ceiling is checked — against everything
 * in the catalog that glows rather than the two somebody looked at.
 *
 * Live rendering starts from what the machine can do, and a headless browser
 * is a software rasterizer — so `pretendGpu` is what puts the path a shopper
 * sees in reach of these.
 */

import { expect, test } from "@playwright/test";
import { backgrounds, drawn, pretendGpu } from "../support/stages.ts";

/** The dark room, where the background has somewhere to be lifted from. */
test.use({ colorScheme: "dark" });

/**
 * The most lightness the background behind a slab may reach, as a percentage.
 *
 * A dark room stays a dark room. Anything above this and the card is lit by
 * its own product rather than displaying it.
 */
const BACKGROUND_CEILING = 20;

/** How saturated the background may get, as a percentage, in a lit room. */
const NEUTRAL_CEILING = 12;

/**
 * Every color in the shop that makes its own light, a page at a time.
 *
 * Only colors: a finisher is photographed rather than lit, so there is no stage of
 * one to flood.
 */
const glowing = (page: number): string =>
  `/?category=color&emissionMin=1&perPage=12&page=${page}`;

test.describe("a glowing product on its card", () => {
  test.beforeEach(async ({ page }) => {
    await pretendGpu(page);
  });

  for (const page of [1, 2] as const) {
    test(`leaves the background dark: page ${page}`, async ({
      page: browserPage,
    }) => {
      await browserPage.goto(glowing(page));
      await drawn(browserPage);

      const stages = await backgrounds(browserPage);

      expect(stages.length).toBeGreaterThan(0);
      for (const stage of stages) {
        expect(stage.peakLightness).toBeLessThanOrEqual(BACKGROUND_CEILING);
      }
    });
  }
});

test.describe("a glowing color in a lit room", () => {
  test.use({ colorScheme: "light" });

  test("leaves the background the gray it was", async ({ page }) => {
    await pretendGpu(page);
    await page.goto(glowing(1));
    await drawn(page);

    // A lit room is gray rather than black, so the ceiling that applies here is
    // the one on color: the wall may not take the pigment's hue.
    for (const stage of await backgrounds(page)) {
      expect(stage.saturation).toBeLessThanOrEqual(NEUTRAL_CEILING);
    }
  });
});
