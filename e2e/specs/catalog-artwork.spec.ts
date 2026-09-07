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
 * The stage draws in WebGL and falls back to a flat swatch on a software
 * renderer, which a headless browser is. `pretendGpu` answers the one question
 * that decision asks, so what runs here is the path a shopper sees.
 */

import { expect, test, type Page } from "@playwright/test";

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

const results = (page: Page) => page.getByRole("region", { name: "Results" });

/** The parameter the software-renderer decision in `scene.ts` reads. */
const UNMASKED_RENDERER_WEBGL = 0x9246;

/**
 * Answer as though this browser had a real GPU.
 *
 * The stage draws a flat swatch instead of a slab when it finds itself on a
 * software renderer, which is what a headless browser is — so without this
 * there is no stage to measure and the check would pass by finding nothing.
 */
const pretendGpu = (page: Page) =>
  page.addInitScript((parameter: number) => {
    const real = WebGL2RenderingContext.prototype.getParameter;

    WebGL2RenderingContext.prototype.getParameter = function (
      this: WebGL2RenderingContext,
      name: number,
    ): unknown {
      return name === parameter ? "Prism Test GPU" : real.call(this, name);
    };
  }, UNMASKED_RENDERER_WEBGL);

type Background = Readonly<{ peakLightness: number; saturation: number }>;

/**
 * The background of every stage on the page, in HSL percentages.
 *
 * Everything outside the middle three fifths, which is where the slab is —
 * so the reading is the room and the spill against it, never the face.
 */
const backgrounds = (page: Page): Promise<readonly Background[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return { peakLightness: 0, saturation: 0 };

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const channel = (index: number): number => pixels[index] ?? 0;
      const near = canvas.width * 0.2;
      const far = canvas.width * 0.8;
      let peak = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let counted = 0;

      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          if (x > near && x < far && y > near && y < far) continue;

          const at = (y * canvas.width + x) * 4;
          const [r, g, b] = [channel(at), channel(at + 1), channel(at + 2)];

          peak = Math.max(peak, (Math.max(r, g, b) + Math.min(r, g, b)) / 2);
          red += r;
          green += g;
          blue += b;
          counted += 1;
        }
      }

      const highest = Math.max(red, green, blue) / counted / 255;
      const lowest = Math.min(red, green, blue) / counted / 255;
      const lightness = (highest + lowest) / 2;

      return {
        peakLightness: (peak / 255) * 100,
        saturation:
          highest === lowest
            ? 0
            : ((highest - lowest) / (1 - Math.abs(2 * lightness - 1))) * 100,
      };
    }),
  );

/**
 * How many stages have had something drawn on them.
 *
 * A stage is a 2D canvas the renderer blits onto, so it is transparent until
 * its turn comes — and its turn comes late here, because a headless browser
 * draws them one at a time on a software renderer. Counting them is what makes
 * the wait a condition rather than a guess at how long the machine takes.
 */
const painted = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
      ].filter((canvas) => {
        const context = canvas.getContext("2d");
        if (context === null || canvas.width === 0) return false;

        const middle = context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;

        return (middle[3] ?? 0) > 0;
      }).length,
  );

/** Long, because every stage is drawn in software here. */
const DRAWN = { timeout: 60_000 };

/** Waits until every card on the page is showing a slab. */
const drawn = async (page: Page): Promise<void> => {
  const cards = results(page).getByRole("article");

  await expect(cards.first()).toBeVisible(DRAWN);
  await expect.poll(() => painted(page), DRAWN).toBe(await cards.count());
};

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
