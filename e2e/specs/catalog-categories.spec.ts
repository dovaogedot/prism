/**
 * The category filter, and the rail that changes shape underneath it.
 *
 * The shop sells three different things and they share almost nothing. What
 * these cover is that the rail offers each category only the controls that
 * category has, that switching does not leave a filter behind that nothing on
 * the chosen shelf could satisfy, and that the page height does not move when
 * a filter narrows the results — which the rail cannot hold steady, since its
 * own height depends on the category.
 */

import { expect, test, type Page } from "@playwright/test";
import { DRAWN, drawn, pretendGpu } from "../support/stages.ts";

const rail = (page: Page) => page.getByRole("complementary");
const results = (page: Page) => page.getByRole("region", { name: "Results" });

const section = (page: Page, title: string) =>
  rail(page).getByRole("button", { name: new RegExp(`^${title}`, "i") });

const categoryRadio = (page: Page, label: string) =>
  rail(page).getByRole("radio", { name: new RegExp(`^${label}`) });

const documentHeight = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollHeight);

/**
 * Waits for the grid, so nothing below is measured against a skeleton.
 *
 * A shelf drawn in software keeps the page busy for longer than the default
 * wait, so a test that pretends a GPU passes `DRAWN` as `wait`.
 */
const ready = async (page: Page, wait: Readonly<{ timeout?: number }> = {}): Promise<void> => {
  await expect(results(page).getByRole("article").first()).toBeVisible(wait);
};

test.describe("choosing a category", () => {
  test("offers all three, counted independently", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    for (const label of ["Colors", "Finishers", "Shifters"]) {
      await expect(categoryRadio(page, label)).toBeVisible();
    }
  });

  test("shows only the shared filters until one is chosen", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    await expect(section(page, "Category")).toBeVisible();
    await expect(section(page, "Foundry")).toBeVisible();
    await expect(section(page, "Price")).toBeVisible();

    // A hue ring is meaningless across a mixed shelf, so it is not offered.
    await expect(section(page, "HSL")).toBeHidden();
    await expect(section(page, "Finish")).toBeHidden();
    await expect(section(page, "Arc")).toBeHidden();
  });

  test("gives colors the hue ring, and all three amounts at once", async ({ page }) => {
    await page.goto("/?category=color");
    await ready(page);

    // One coordinate in three parts, behind one heading.
    await expect(section(page, "HSL")).toBeVisible();
    // And the finish behind another — three axes, all live, because a color
    // carries all three and narrowing one says nothing about the others.
    await expect(section(page, "Finish")).toBeVisible();
    await expect(page.getByRole("slider", { name: /Roughness, minimum/ })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Coating, minimum/ })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Emission, minimum/ })).toBeVisible();
    // Nothing to pick between them.
    await expect(rail(page).getByRole("radio", { name: /^Iridescent/ })).toHaveCount(0);
    await expect(section(page, "Arc")).toBeHidden();
  });

  test("gives finishers the finish they apply, and no color of their own", async ({
    page,
  }) => {
    await page.goto("/?category=finisher");
    await ready(page);

    // A finisher has no hue, and it is not a surface with three amounts on it — it
    // is bought for the one effect it produces, so its filter is the word.
    await expect(section(page, "Finish")).toBeVisible();
    await expect(section(page, "HSL")).toBeHidden();
    for (const name of ["Roughness", "Iridescent", "Fluorescent"]) {
      await expect(rail(page).getByRole("radio", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(page.getByRole("slider", { name: /Roughness/ })).toHaveCount(0);
  });

  test("narrows colors by more than one amount at a time", async ({ page }) => {
    // The whole point of three axes rather than a choice between them: a
    // lacquered surface that is also iridescent is a thing real paint is.
    await page.goto("/?category=color&roughnessMax=40&coatingMin=100");
    await ready(page);

    await expect(page.getByRole("slider", { name: /Roughness, maximum/ })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Coating, minimum/ })).toBeVisible();
    await expect(page.getByText("Nothing matches that.")).toBeHidden();
  });

  test("a finish name narrows the finishers to the ones that apply it", async ({ page }) => {
    await page.goto("/?category=finisher");
    await ready(page);

    const everything = await results(page).getByRole("article").count();

    await rail(page).getByRole("radio", { name: /^Iridescent/ }).click();
    await expect(page).toHaveURL(/finish=iridescent/);

    // The shelf it replaces stays on screen while this one loads, so the count
    // is polled rather than read once. A bucket that returned the whole shelf
    // would hold it where it started.
    await expect
      .poll(() => results(page).getByRole("article").count())
      .toBeLessThan(everything);
  });

  test("a category showing zero is still selectable", async ({ page }) => {
    // A color family zeroes the other two honestly, but choosing one of them
    // clears the family on the way — so locking it would be a dead end that is
    // not actually dead. Everywhere else in the rail, zero does lock.
    await page.goto("/?category=color&family=black");
    await ready(page);

    const finishers = categoryRadio(page, "Finishers");
    await expect(finishers).toBeEnabled();

    await finishers.click();
    await expect(page).toHaveURL(/category=finisher/);
    await expect(page).not.toHaveURL(/family=/);

    await ready(page);
    await expect(page.getByText("Nothing matches that.")).toBeHidden();
  });
});

test.describe("the shifter controls", () => {
  test("the direction toggle filters, and clears", async ({ page }) => {
    await page.goto("/?category=shifter");
    await ready(page);

    await rail(page).getByRole("button", { name: "↺ CCW" }).click();
    await expect(page).toHaveURL(/direction=ccw/);

    await rail(page).getByRole("button", { name: /Counter-clockwise/ }).click();
    await expect(page).not.toHaveURL(/direction=/);
  });

  test("every shifter card states both of its facts, once each", async ({ page }) => {
    await page.goto("/?category=shifter");
    await ready(page);

    const cards = await results(page).getByRole("article").count();

    // The dial draws the arc and prints the two facts under it: which way
    // round, and how far.
    await expect(results(page).getByText(/^[↻↺]$/)).toHaveCount(cards);
    await expect(results(page).getByText(/^\d+°$/)).toHaveCount(cards);
  });
});

test.describe("layout stability across categories", () => {
  for (const [label, url, narrowed] of [
    ["finishers", "/?category=finisher", "/?category=finisher&finish=fluorescent"],
    ["shifters", "/?category=shifter", "/?category=shifter&arcMin=200&direction=ccw"],
  ] as const) {
    test(`the page is the same height however few ${label} match`, async ({ page }) => {
      await page.goto(url);
      await ready(page);
      const full = await documentHeight(page);

      await page.goto(narrowed);
      await ready(page);

      // A page holds a full page of slots whether or not there is stock to
      // fill them, so narrowing cannot pull the scroll position with it.
      expect(await documentHeight(page)).toBe(full);
    });
  }
});

test.describe("measurements differ by category", () => {
  const measurementLabels = async (page: Page): Promise<readonly string[]> =>
    page.locator("dl").last().locator("dt").allTextContents();

  const openFirst = async (page: Page, category: string): Promise<void> => {
    await page.goto(`/?category=${category}`);
    await ready(page);
    await results(page).getByRole("article").first().getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Measurements" })).toBeVisible();
  };

  test("a color measures how it burns, reads, is coated and looks", async ({
    page,
  }) => {
    await openFirst(page, "color");
    expect(await measurementLabels(page)).toEqual([
      "Temperature",
      "Reach",
      "Coating",
      "Weight",
    ]);
  });

  test("a coating is quoted in nanometers, and in microinches to order", async ({
    page,
  }) => {
    // The one measurement in the shop small enough to need the unit below a
    // mil, which is where the metric and imperial halves stop being the same
    // number with a different name on it.
    await openFirst(page, "color");

    const coating = page.locator("dl").last().locator("dd").nth(2);
    await expect(coating).toHaveText(/^\d+ nm$/);

    await page.getByRole("button", { name: "imperial" }).click();
    await expect(coating).toHaveText(/^[\d.]+ µin$/);
  });

  test("a finisher measures the one dimension its own effect has", async ({ page }) => {
    // Which dimension that is depends on what the finisher does — a grain, a
    // thickness or a reach — so what is pinned here is the shape: one
    // dimension, then the weight every finisher has.
    await openFirst(page, "finisher");

    const labels = await measurementLabels(page);

    expect(labels).toHaveLength(2);
    expect(["Grain", "Coating", "Reach"]).toContain(labels[0]);
    expect(labels[1]).toBe("Weight");
  });

  test("a shifter measures the mechanism", async ({ page }) => {
    await openFirst(page, "shifter");
    expect(await measurementLabels(page)).toEqual(["Torque", "Backlash", "Weight"]);
  });

  test("temperature is shown in Celsius and Fahrenheit, never Kelvin", async ({ page }) => {
    // Kelvin is what the column stores and what both of these come from, but
    // "6208 K" describes a light source rather than a color.
    await openFirst(page, "color");

    const temperature = page.locator("dl").last().locator("dd").first();
    await expect(temperature).toHaveText(/°C$/);
    await expect(temperature).not.toHaveText(/K/);

    await page.getByRole("button", { name: "imperial" }).click();
    await expect(temperature).toHaveText(/°F$/);
  });

  test("the toggle swaps every row into the other vocabulary", async ({ page }) => {
    await openFirst(page, "shifter");

    const values = () => page.locator("dl").last().locator("dd").allTextContents();

    expect(await values()).toEqual([
      expect.stringContaining("N·m"),
      expect.stringContaining("mm"),
      expect.stringContaining("g"),
    ]);

    await page.getByRole("button", { name: "imperial" }).click();

    expect(await values()).toEqual([
      expect.stringContaining("lbf·ft"),
      expect.stringContaining("in"),
      expect.stringContaining("oz"),
    ]);
  });
});

test.describe("a finisher shows what it does", () => {
  /** The pictures of one finisher, which is the strip under the large one. */
  const pictures = (page: Page) => page.getByRole("list", { name: "Pictures" });

  /** The large picture at the top of a product page, whatever it is made of. */
  const lead = (page: Page) => page.getByRole("article").first();

  test("shows what it does on its card, rather than a slab of color", async ({
    page,
  }) => {
    await page.goto("/?category=finisher");
    await ready(page);

    const card = results(page).getByRole("article").first();

    // A finisher holds no color, so there is nothing to light: on a machine
    // that cannot draw a room, its card carries the rendered picture of its
    // effect instead.
    await expect(card.locator("img")).toHaveCount(1);
    await expect(card.locator("canvas")).toHaveCount(0);
  });

  test("opens on the effect and the same effect over four pigments", async ({
    page,
  }) => {
    await page.goto("/?category=finisher");
    await ready(page);
    await results(page).getByRole("article").first().getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Measurements" })).toBeVisible();

    const thumbnails = pictures(page).getByRole("button");
    await expect(thumbnails).toHaveCount(5);

    const large = lead(page).locator("img").first();
    const before = await large.getAttribute("src");

    await thumbnails.last().click();

    await expect(large).not.toHaveAttribute("src", String(before));
  });

  test.describe("on a machine that can draw one", () => {
    // A room here is rasterized in software, which the default does not allow
    // enough time for.
    test.describe.configure({ timeout: 120_000 });

    test.beforeEach(async ({ page }) => {
      await pretendGpu(page);
    });

    test("draws the room on its card in place of the photograph", async ({
      page,
    }) => {
      await page.goto("/?category=finisher");
      await ready(page, DRAWN);
      await drawn(page);

      const card = results(page).getByRole("article").first();

      await expect(card.locator("canvas")).toHaveCount(1);
      await expect(card.locator("img")).toHaveCount(0);
    });

    test("opens on the room, and the photographs are still under it", async ({
      page,
    }) => {
      await page.goto("/?category=finisher");
      await ready(page, DRAWN);
      await results(page).getByRole("article").first().getByRole("link").click();
      await expect(page.getByRole("heading", { name: "Measurements" })).toBeVisible(DRAWN);
      await drawn(page);

      await expect(lead(page).locator("canvas")).toHaveCount(1);

      // The room stands in for the first picture only. The other four are what
      // they always were, and choosing one puts a photograph back.
      const thumbnails = pictures(page).getByRole("button");

      await expect(thumbnails).toHaveCount(5);
      await thumbnails.last().click();

      await expect(lead(page).locator("canvas")).toHaveCount(0);
      await expect(lead(page).getByRole("img")).toHaveCount(1);
    });
  });
});
