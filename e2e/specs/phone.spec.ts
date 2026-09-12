/**
 * The shop on a phone.
 *
 * Below the width the filters stand beside the results at, the header keeps
 * the wordmark, the account and a button that opens a drawer, and the drawer
 * slides in holding the switches, signing out and, on the catalog, the
 * filters. The sort and the filters are icons on the search box's row. Tilting
 * the phone turns the pictures, and where the phone reports no tilt, a finger
 * drawn across a picture does. What these cover is that nothing in the header
 * wraps or runs past its edge, that each of those things is where it is meant
 * to be and works from there, and that the drawer moves rather than appears.
 */

import { devices, expect, test, type Page } from "@playwright/test";
import { SHOPPER } from "../support/accounts.ts";
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

/** Signs the shopper in, and waits for the header to show the account. */
const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(SHOPPER.email);
  await page.getByLabel("Password").fill(SHOPPER.password);
  await page.getByRole("button", { name: "Sign in" }).tap();

  await expect(page.getByRole("banner").getByRole("link", { name: "Your account" })).toBeVisible();
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

/**
 * Where the drawer's left edge is as it starts to move and as it arrives, in
 * CSS pixels, what the move carries, and whether the drawer is open as it
 * arrives, after the menu button is pressed or the close button is. Resolves
 * once the move is over.
 *
 * Both edges are read off the drawer's own transitions rather than off the
 * clock: the first right as they begin, the second with them taken to their
 * last millisecond. The last one rather than the end itself, because a drawer
 * that has slid out is no longer displayed and has no edge to read.
 */
const slide = (page: Page, button: "Open menu" | "Close menu") =>
  page.evaluate(async (name) => {
    const drawer = document.querySelector<HTMLDialogElement>("dialog.drawer");

    document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)?.click();

    if (drawer === null) {
      return { from: Number.NaN, to: Number.NaN, width: 0, moves: [], open: false };
    }

    const moving = drawer
      .getAnimations()
      .filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
    const { left: from, width } = drawer.getBoundingClientRect();

    for (const animation of moving) {
      const end = animation.effect?.getComputedTiming().endTime;

      if (typeof end === "number") animation.currentTime = end - 1;
    }

    const to = drawer.getBoundingClientRect().left;
    const { open } = drawer;

    await Promise.all(moving.map((animation) => animation.finished));

    return {
      from,
      to,
      width,
      moves: moving.map((animation) => animation.transitionProperty),
      open,
    };
  }, button);

/** A shelf of each kind of picture a finger or a tilt moves, and what to call it. */
const DRAWING = [
  ["a color", "/?category=color"],
  ["a finisher's room", "/?category=finisher"],
] as const;

/** Reports a tilt to the page the way a phone does, in degrees. */
const tiltTo = (page: Page, beta: number, gamma: number): Promise<void> =>
  page.evaluate(
    ([front, side]) => {
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: front, gamma: side }),
      );
    },
    [beta, gamma] as const,
  );

/**
 * Waits while the page draws this many frames.
 *
 * Counted in frames rather than on the clock, because a stage moves on the
 * frames it is given; one that was going to move has moved well inside a
 * second's worth.
 */
const framesPass = (page: Page, count: number): Promise<void> =>
  page.evaluate(
    (left) =>
      new Promise<void>((done) => {
        const tick = (remaining: number): void => {
          if (remaining <= 0) done();
          else requestAnimationFrame(() => tick(remaining - 1));
        };

        tick(left);
      }),
    count,
  );

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

test("slides the drawer in from the edge, and back out", async ({ page }) => {
  await page.goto("/");

  const opening = await slide(page, "Open menu");

  expect(opening.moves).toContain("translate");
  expect(opening.from).toBeLessThanOrEqual(-opening.width + 1);
  expect(opening.to).toBeCloseTo(0, 0);

  const closing = await slide(page, "Close menu");

  expect(closing.moves).toContain("translate");
  expect(closing.from).toBeCloseTo(0, 0);
  expect(closing.to).toBeLessThanOrEqual(-closing.width + 1);
  // Still open all the way out: a dialog that is closed first leaves the
  // screen at once wherever the browser cannot carry it through a transition.
  expect(closing.open).toBe(true);
  await expect(drawer(page)).toBeHidden();
});

test("slides the drawer back out on Escape", async ({ page }) => {
  await page.goto("/");
  await slide(page, "Open menu");

  await page.keyboard.press("Escape");

  await expect(drawer(page)).toHaveAttribute("data-closing");
  await expect(drawer(page)).toBeHidden();
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

test("puts the sort and the filters as icons on the search box's row", async ({ page }) => {
  for (const width of [NARROWEST, PHONE.viewport.width]) {
    await page.setViewportSize({ width, height: PHONE.viewport.height });
    await page.goto("/");
    await ready(page);

    const search = await page.getByRole("combobox", { name: "Search colors" }).boundingBox();
    const sort = page.getByRole("combobox", { name: "Sort by" });
    const sortBox = await sort.boundingBox();
    const filtersBox = await page.getByRole("button", { name: "Filters", exact: true }).boundingBox();

    expect([search, sortBox, filtersBox]).not.toContain(null);
    if (search === null || sortBox === null || filtersBox === null) return;

    const middle = (box: { y: number; height: number }): number => box.y + box.height / 2;

    // One row: every control centered on the search box's line, left to right,
    // and none of them past the page's edge.
    expect(Math.abs(middle(sortBox) - middle(search))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(filtersBox) - middle(search))).toBeLessThanOrEqual(1);
    expect(search.x + search.width).toBeLessThanOrEqual(sortBox.x);
    expect(sortBox.x + sortBox.width).toBeLessThanOrEqual(filtersBox.x);
    expect(filtersBox.x + filtersBox.width).toBeLessThanOrEqual(width);

    // An icon is a square, where a word would run wider than it is tall.
    for (const box of [sortBox, filtersBox]) {
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    }
  }

  // The tap on the sort's icon lands on the select, which sorts the shelf.
  const sort = page.getByRole("combobox", { name: "Sort by" });

  await sort.tap({ trial: true });
  await sort.selectOption("price_asc");
  await expect(page).toHaveURL(/sort=price_asc/);
});

test.describe("signed in", () => {
  test("puts the account in the header, and signing out at the foot of the drawer", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/");
    await ready(page);

    const header = page.getByRole("banner");

    await expect(header.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    await header.getByRole("link", { name: "Your account" }).tap();
    await expect(page).toHaveURL(/\/account$/);

    // Back on the catalog, where the filters run the drawer past its own
    // height, so the foot is held there rather than reached by scrolling.
    await page.goto("/");
    await ready(page);
    await header.getByRole("button", { name: "Open menu" }).tap();

    const signOut = drawer(page).getByRole("button", { name: "Sign out" });
    const box = await signOut.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box === null || viewport === null) return;

    const scroller = await drawer(page).evaluate((dialog) => {
      const inside = dialog.querySelector(".overflow-y-auto");

      return { runs: inside?.scrollHeight ?? 0, shows: inside?.clientHeight ?? 0 };
    });

    expect(scroller.runs).toBeGreaterThan(scroller.shows);
    expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(20);

    await signOut.tap();

    await expect(drawer(page)).toBeHidden();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("a phone that can draw", () => {
  test.beforeEach(async ({ page }) => {
    await pretendGpu(page);
  });

  for (const [what, shelf] of DRAWING) {
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

  for (const [what, shelf] of DRAWING) {
    test(`turns ${what} as the phone tilts`, async ({ page }) => {
      await page.goto(shelf);
      await expect(results(page).getByRole("article").first()).toBeVisible(DRAWN);
      await drawn(page);

      const resting = await signature(page);

      expect(resting).not.toBe("");

      // The first reading is how the phone is held, which reads as the middle;
      // the second brings its right edge up.
      await tiltTo(page, 45, 0);
      await tiltTo(page, 45, -15);

      await expect.poll(() => signature(page), { timeout: 30_000 }).not.toBe(resting);
    });
  }

  test("leaves a finger to the page once the phone tilts", async ({ page }) => {
    await page.goto("/?category=color");
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

    // Held the way it is held, so the tilt keeps the picture where it is.
    await tiltTo(page, 45, 0);

    await finger("touchStart", box.x + box.width * 0.5, y);
    for (const along of [0.4, 0.3, 0.2, 0.1]) {
      await finger("touchMove", box.x + box.width * along, y);
    }
    await framesPass(page, 90);

    expect(await signature(page)).toBe(resting);

    await finger("touchEnd", 0, 0);
  });
});
