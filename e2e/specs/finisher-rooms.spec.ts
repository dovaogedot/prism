/**
 * The rooms a finisher is demonstrated in, and the switch that draws them.
 *
 * A finisher has no color and no form of its own, so what it sells can only be
 * shown by showing it done: a room of plain shapes with the finish on all of
 * them, built from the finisher's one amount. There are three rooms, one per
 * thing a finish can apply to, and every one of them answers the pointer.
 *
 * Live rendering starts from what the machine can do and the visitor can
 * overrule it, so most of what is here is about which of the two pictures — the
 * room or the photograph the shop already has — a page ends up showing.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  colorBoxes,
  corners,
  DRAWN,
  drawn,
  hueSpread,
  outerRings,
  pretendGpu,
  signature,
  surfacesOf,
} from "../support/stages.ts";

/**
 * Room to draw in.
 *
 * Every test here waits on a picture that a headless browser rasterizes in
 * software, several of them at once across workers. That is slower than the
 * default allows for, and slow is not the same as wrong.
 */
test.describe.configure({ timeout: 120_000 });

/**
 * The most lightness a glowing room's corners may reach, as a percentage.
 *
 * The corners are the part of a stage nothing stands in, so what reaches them
 * is the room's own light and whatever has spilled off the subjects. A
 * fluorescent finisher is the hardest case there is: three faces at the top of
 * what the display can show, with the bloom that says so drawn around all
 * three. If that spill were escaping the subjects the corners would climb
 * toward the faces themselves, which sit well above this.
 */
const CORNER_CEILING = 70;

const results = (page: Page) => page.getByRole("region", { name: "Results" });

/** The finish names on the rail, and the room each of them is demonstrated in. */
const FINISHES = [
  ["roughness", "a grain"],
  ["iridescent", "a coating"],
  ["fluorescent", "a glow"],
] as const;

/** The shelf of finishers that apply one finish. */
const shelf = (finish: string): string => `/?category=finisher&finish=${finish}`;

/** Opens the first finisher on a shelf and waits for its page to be there. */
const openFirst = async (page: Page, finish: string): Promise<void> => {
  await page.goto(shelf(finish));
  await expect(results(page).getByRole("article").first()).toBeVisible(DRAWN);
  await results(page).getByRole("article").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Measurements" })).toBeVisible(DRAWN);
};

/** Points at a spot a quarter of the way into the first stage on the page. */
const pointInto = async (page: Page): Promise<void> => {
  const box = await page.locator("canvas.stage__canvas").first().boundingBox();

  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
};

test.describe("a machine that can draw", () => {
  test.beforeEach(async ({ page }) => {
    await pretendGpu(page);
  });

  for (const [finish, room] of FINISHES) {
    test(`draws ${room} for a ${finish} finisher, on its own page`, async ({
      page,
    }) => {
      await openFirst(page, finish);

      expect(await drawn(page)).toBe(1);
    });
  }

  for (const [finish, room] of FINISHES) {
    test(`moves ${room} when the pointer moves over it`, async ({ page }) => {
      await openFirst(page, finish);
      await drawn(page);

      const resting = await signature(page);

      expect(resting).not.toBe("");
      await pointInto(page);
      await expect.poll(() => signature(page), { timeout: 30_000 }).not.toBe(resting);
    });
  }

  test("keeps a glowing room's spill inside its own stage", async ({ page }) => {
    await page.goto(shelf("fluorescent"));
    await drawn(page);

    const rooms = await corners(page);

    expect(rooms.length).toBeGreaterThan(0);
    for (const peak of rooms) {
      expect(peak).toBeLessThanOrEqual(CORNER_CEILING);
    }
  });

  /**
   * How far apart the two ends of a glowing shelf have to spill.
   *
   * The shelf holds one finisher per amount and every one of them is in the
   * top half of the range, so the thing that has to hold is that they still
   * look like different amounts: the hardest glow on it puts this many times
   * as much light into the outer fifth of its stage as the faintest does.
   * Read in the dark theme, which is the one a glow is dressed for — a bright
   * room is already carrying most of that ring by itself.
   */
  const GLOW_SPREAD = 1.7;

  test("spills further off a harder glow than off a fainter one", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(shelf("fluorescent"));
    await drawn(page);

    const rings = await outerRings(page);

    expect(rings.length).toBeGreaterThan(1);
    expect(Math.max(...rings)).toBeGreaterThanOrEqual(Math.min(...rings) * GLOW_SPREAD);
  });

  /**
   * What the floor and the walls of a corner have to be carrying.
   *
   * `overlap` is how much of the floor, in percent, has to lie where two
   * shadows overlap. One lamp cannot lay a shadow inside its own shadow, so
   * this is what says more than one lamp is casting, whatever the size or the
   * darkness of any one shadow. `walls` is how many times as bright the
   * brightest part of each wall has to be as its dimmest — a wall that holds
   * one value from edge to edge is a backdrop, not a wall with light falling
   * on it.
   */
  const CORNER_SURFACES = { overlap: 2, walls: 2 };

  /** The two corners, by the finish shown in each. */
  const CORNERS = [
    ["roughness", "a grain"],
    ["iridescent", "a coating"],
  ] as const;

  for (const [finish, room] of CORNERS) {
    for (const scheme of ["dark", "light"] as const) {
      test(`lays overlapping shadows and lights both walls unevenly around ${room}, ${scheme}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openFirst(page, finish);
        await drawn(page);

        const { overlap, walls } = await surfacesOf(page);

        expect(overlap).toBeGreaterThanOrEqual(CORNER_SURFACES.overlap);
        expect(walls.left).toBeGreaterThanOrEqual(CORNER_SURFACES.walls);
        expect(walls.right).toBeGreaterThanOrEqual(CORNER_SURFACES.walls);
      });
    }
  }

  /**
   * What a shelf of coating rooms has to show, around the hue wheel.
   *
   * A coating splits the light it reflects, so a room demonstrating one carries
   * colors nothing in it was painted: `each` is what the thinnest film on the
   * shelf manages and `strongest` says the colors are on the surfaces rather
   * than in one highlight. Both fall away as the pigment under the film is
   * mixed brighter, because a pigment's own color is added under the
   * interference and covers it.
   *
   * `ownHue` holds the other end: how much of the colored part, in percent,
   * falls in the busiest step of the wheel. The subjects are painted at one
   * hue each and the pointer turns those hues, so their color has to gather
   * around one step rather than spread evenly over the wheel — and a pigment
   * mixed dark enough to lose that is one whose hue the pointer no longer
   * visibly moves. All three are read in the light theme, where the room is
   * gray, so every colored pixel is on a subject.
   */
  const COATING_COLORS = { each: 8, strongest: 16, ownHue: 9 };

  test("shows colors in a coating room that nothing in it was painted", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(shelf("iridescent"));
    await drawn(page);

    const rooms = await hueSpread(page);

    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room.steps).toBeGreaterThanOrEqual(COATING_COLORS.each);
      expect(room.peak).toBeGreaterThanOrEqual(COATING_COLORS.ownHue);
    }
    expect(Math.max(...rooms.map((room) => room.steps))).toBeGreaterThanOrEqual(
      COATING_COLORS.strongest,
    );
  });

  /**
   * What the coated subjects have to take up on their stage.
   *
   * `across` is how much of the stage's width the colored part of it spans,
   * which says the near subject is close enough to be looked at rather than
   * surveyed from across the room. `clear` is how far that part stops short of
   * every edge, which says it is framed rather than cut off by one — and both
   * have to hold at once, because either alone is met by a room that is empty
   * or by one the eye has walked into.
   */
  const COATING_FRAME = { across: 0.72, clear: 0.05 };

  test("frames the coated subjects large, and inside the stage", async ({ page }) => {
    await page.goto(shelf("iridescent"));
    await drawn(page);

    const rooms = await colorBoxes(page);

    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room.right - room.left).toBeGreaterThanOrEqual(COATING_FRAME.across);
      expect(room.left).toBeGreaterThanOrEqual(COATING_FRAME.clear);
      expect(1 - room.right).toBeGreaterThanOrEqual(COATING_FRAME.clear);
      expect(room.top).toBeGreaterThanOrEqual(COATING_FRAME.clear);
      expect(1 - room.bottom).toBeGreaterThanOrEqual(COATING_FRAME.clear);
    }
  });

  test("draws the room once and leaves it still, where less motion is asked for", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFirst(page, "iridescent");
    await drawn(page);

    const resting = await signature(page);

    await pointInto(page);
    // Long enough that a room that was going to move would have: the whole
    // travel of one settles well inside a second.
    await page.waitForTimeout(2_000);

    expect(await signature(page)).toBe(resting);
  });
});

test.describe("the switch in the header", () => {
  const control = (page: Page, to: "live" | "still") =>
    page.getByRole("button", { name: `Switch to ${to} pictures` });

  test("puts the photographs back, and they stay back over a reload", async ({
    page,
  }) => {
    await pretendGpu(page);
    await page.goto(shelf("roughness"));
    await drawn(page);

    await control(page, "still").click();

    const cards = results(page).getByRole("article");

    await expect(page.locator("canvas.stage__canvas")).toHaveCount(0);
    await expect(cards.first().locator("img")).toHaveCount(1);
    await expect(control(page, "live")).toBeVisible();

    await page.reload();
    await expect(cards.first()).toBeVisible(DRAWN);

    await expect(page.locator("canvas.stage__canvas")).toHaveCount(0);
    await expect(cards.first().locator("img")).toHaveCount(1);
  });

  test("starts off on a machine that reports a software rasterizer", async ({
    page,
  }) => {
    // No `pretendGpu`: a headless browser is exactly that machine.
    await page.goto(shelf("roughness"));

    const cards = results(page).getByRole("article");

    await expect(cards.first()).toBeVisible(DRAWN);
    await expect(page.locator("canvas.stage__canvas")).toHaveCount(0);
    await expect(cards.first().locator("img")).toHaveCount(1);
    await expect(control(page, "live")).toBeVisible();
  });
});
