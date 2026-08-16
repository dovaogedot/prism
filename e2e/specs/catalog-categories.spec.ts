/**
 * The category filter, and the rail that changes shape underneath it.
 *
 * The shop sells three different things and they share almost nothing. What
 * these cover is that the rail offers each category only the controls that
 * category has, that switching does not leave a filter behind that nothing on
 * the new shelf could satisfy, and that the page height still does not move
 * when a filter narrows the results — which used to be the filter rail's doing,
 * back when the rail was always the taller of the two columns.
 */

import { expect, test, type Page } from "@playwright/test";

const rail = (page: Page) => page.getByRole("complementary");
const results = (page: Page) => page.getByRole("region", { name: "Results" });

const section = (page: Page, title: string) =>
  rail(page).getByRole("button", { name: new RegExp(`^${title}`, "i") });

const categoryRadio = (page: Page, label: string) =>
  rail(page).getByRole("radio", { name: new RegExp(`^${label}`) });

const documentHeight = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollHeight);

/** Waits for the grid, so nothing below is measured against a skeleton. */
const ready = async (page: Page): Promise<void> => {
  await expect(results(page).getByRole("article").first()).toBeVisible();
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
    await expect(section(page, "Hue")).toBeHidden();
    await expect(section(page, "Finish")).toBeHidden();
    await expect(section(page, "Arc")).toBeHidden();
  });

  test("gives colors the hue ring, the ramps and the finishes", async ({ page }) => {
    await page.goto("/?category=color");
    await ready(page);

    await expect(section(page, "Hue")).toBeVisible();
    await expect(section(page, "Saturation")).toBeVisible();
    await expect(section(page, "Lightness")).toBeVisible();
    await expect(section(page, "Finish")).toBeVisible();
    await expect(section(page, "Arc")).toBeHidden();
  });

  test("gives finishers one finish and nothing else", async ({ page }) => {
    await page.goto("/?category=finisher");
    await ready(page);

    await expect(section(page, "Finish")).toBeVisible();
    await expect(section(page, "Hue")).toBeHidden();

    // A finisher applies exactly one finish, so the control is exclusive.
    const finishes = rail(page).getByRole("radio", { name: /Matte|Gloss/ });
    await expect(finishes.first()).toBeVisible();
    await expect(rail(page).getByRole("checkbox", { name: /Matte/ })).toHaveCount(0);
  });

  test("gives shifters an arc and a direction", async ({ page }) => {
    await page.goto("/?category=shifter");
    await ready(page);

    await expect(section(page, "Arc")).toBeVisible();
    await expect(section(page, "Direction")).toBeVisible();
    await expect(section(page, "Hue")).toBeHidden();
    await expect(section(page, "Finish")).toBeHidden();
  });
});

test.describe("switching category", () => {
  test("drops the filters the new category cannot satisfy", async ({ page }) => {
    // An arc left behind on a shelf of colors would return nothing, with no
    // control on screen to explain why.
    await page.goto("/?category=shifter&arcMin=90&direction=cw");
    await ready(page);

    await categoryRadio(page, "Colors").click();
    await expect(page).toHaveURL(/category=color/);
    await expect(page).not.toHaveURL(/arcMin=/);
    await expect(page).not.toHaveURL(/direction=/);

    await ready(page);
    await expect(page.getByText("Nothing matches that.")).toBeHidden();
  });

  test("clicking the chosen category again clears it", async ({ page }) => {
    await page.goto("/?category=finisher");
    await ready(page);

    await categoryRadio(page, "Finishers").click();
    await expect(page).not.toHaveURL(/category=/);
  });

  test("a category showing zero is still selectable", async ({ page }) => {
    // A color tag zeroes the other two honestly, but choosing one of them
    // clears that tag on the way — so locking it would be a dead end that is
    // not actually dead. Everywhere else in the rail, zero does lock.
    await page.goto("/?category=color&tag=black");
    await ready(page);

    const finishers = categoryRadio(page, "Finishers");
    await expect(finishers).toBeEnabled();

    await finishers.click();
    await expect(page).toHaveURL(/category=finisher/);
    await expect(page).not.toHaveURL(/tag=/);

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

    // The dial draws the arc, so the badge names the way round — between them a
    // card states both facts without saying either twice.
    await expect(results(page).getByText(/^[↻↺] (cw|ccw)$/i)).toHaveCount(cards);
    await expect(results(page).getByText(/^\d+°$/)).toHaveCount(cards);
  });
});

test.describe("layout stability across categories", () => {
  for (const [label, url, narrowed] of [
    ["finishers", "/?category=finisher", "/?category=finisher&finishes=gloss"],
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

  test("a color measures how it burns, reads and looks", async ({ page }) => {
    await openFirst(page, "color");
    expect(await measurementLabels(page)).toEqual(["Temperature", "Reach", "Weight"]);
  });

  test("a finisher measures the tin instead", async ({ page }) => {
    await openFirst(page, "finisher");
    expect(await measurementLabels(page)).toEqual(["Coverage", "Grain", "Weight"]);
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
