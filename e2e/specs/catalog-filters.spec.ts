/**
 * The filter rail, in a real browser.
 *
 * These cover the things unit and integration tests structurally cannot: that
 * the rail does not reflow when filters change, and that the drag interactions
 * on the hue ring and range sliders actually work.
 */

import { expect, test, type Page } from "@playwright/test";

const rail = (page: Page) => page.getByRole("complementary");

const searchBox = (page: Page) =>
  page.getByRole("combobox", { name: "Search colors" });

const results = (page: Page) => page.getByRole("region", { name: "Results" });

const sectionToggle = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(`^${title}`, "i") });

/**
 * Position within the document rather than the viewport. Clicking a control
 * below the fold scrolls the page, which shifts every viewport-relative
 * coordinate and would read as a layout shift when nothing has moved.
 */
const documentY = async (page: Page, title: string): Promise<number> => {
  const box = await sectionToggle(page, title).boundingBox();
  const scrolled = await page.evaluate(() => window.scrollY);
  return Math.round((box?.y ?? 0) + scrolled);
};

test.beforeEach(async ({ page }) => {
  // Inside the Colors category: the hue ring and the two ramps only exist
  // there, since neither means anything on a shelf of finishers.
  // `catalog-categories.spec.ts` covers the switch itself.
  await page.goto("/?category=color");
  await expect(page.getByRole("heading", { name: "Every color, on its own terms" })).toBeVisible();

  // The heading renders before the facets arrive — the rail is skeletons until
  // then. Counting or measuring anything in it before this point races the
  // first paint.
  await expect(
    rail(page).getByRole("checkbox", { name: /Chroma Labs/ }),
  ).toBeVisible();
});

test.describe("layout stability", () => {
  test("the rail does not move when a filter is applied", async ({ page }) => {
    // Settle the scroll position first, so the measurement is not taken
    // across the auto-scroll that clicking a below-the-fold control causes.
    const chroma = rail(page).getByRole("checkbox", { name: /Chroma Labs/ });
    await chroma.scrollIntoViewIfNeeded();

    const before = await documentY(page, "Finish");

    // Ticking a foundry adds a "1 chosen" badge to the Foundry header. If the
    // header can grow, every section below it shifts.
    await chroma.click();
    await expect(chroma).toBeChecked();
    await expect(page.getByText(/1 chosen/)).toBeVisible();

    expect(await documentY(page, "Finish")).toBe(before);

    // And a second filter must not move it either.
    const cyan = rail(page).getByRole("checkbox", { name: /Cyan & Sons/ });
    await cyan.click();
    await expect(cyan).toBeChecked();

    expect(await documentY(page, "Finish")).toBe(before);
  });

  test("the page is the same height however few results there are", async ({ page }) => {
    // Two things hold this still: the rail never reflows, and the grid always
    // holds a full page of slots whether or not there is stock to fill them.
    // Either one alone would be enough here; both matter, because which of the
    // two columns is the taller now depends on the category.
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);

    const full = await height();

    await page.goto("/?category=color&minRating=5&roughnessMin=80");
    await page.waitForLoadState("networkidle");
    expect(await height()).toBe(full);

    await page.goto("/?category=color&q=zzzznothingatall");
    await page.waitForLoadState("networkidle");
    expect(await height()).toBe(full);
  });

  test("no bucket disappears when the result set shrinks", async ({ page }) => {
    const brandBoxes = rail(page).getByRole("checkbox");
    const before = await brandBoxes.count();

    const bauhaus = rail(page).getByRole("checkbox", { name: /Bauhaus Bros/ });
    await bauhaus.click();
    await expect(bauhaus).toBeChecked();
    await page.waitForLoadState("networkidle");

    expect(await brandBoxes.count()).toBe(before);
  });

  test("an empty bucket is struck through rather than removed", async ({ page }) => {
    // Narrow hard enough that some foundry stocks nothing matching. A glow
    // needs a vivid pigment, and the blacks are the least vivid shelf there is.
    await page.goto("/?category=color&family=black&emissionMin=35");
    await page.waitForLoadState("networkidle");

    const struck = rail(page).locator("label.line-through");
    await expect(struck.first()).toBeVisible();

    // Struck rows are disabled, so they cannot be clicked into a dead end —
    // whichever control the row happens to carry.
    await expect(struck.first().locator("input")).toBeDisabled();
  });
});

test.describe("star rating", () => {
  test("clicking a star sets the minimum rating", async ({ page }) => {
    await page.getByRole("button", { name: "4 stars and up" }).click();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/minRating=4/);
    await expect(page.getByText(/4★ & up — \d+ item/)).toBeVisible();
  });

  test("clicking the same star again clears it", async ({ page }) => {
    const fourth = page.getByRole("button", { name: "4 stars and up" });

    await fourth.click();
    await expect(page).toHaveURL(/minRating=4/);

    await fourth.click();
    await expect(page).not.toHaveURL(/minRating/);
  });
});

test.describe("hue ring", () => {
  test("clicking the ring selects an arc", async ({ page }) => {
    const ring = page.getByRole("button", { name: "Select a hue range" });
    await ring.scrollIntoViewIfNeeded();
    const box = await ring.boundingBox();
    expect(box).not.toBeNull();

    // Click the top of the ring — 0°, the reds.
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + 14,
    );
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/hueMin=\d+/);
    await expect(page.getByRole("slider", { name: "Hue range start" })).toBeVisible();
  });

  test("dragging a thumb changes only that end", async ({ page }) => {
    await page.goto("/?category=color&hueMin=0&hueMax=60");
    await page.waitForLoadState("networkidle");

    const endThumb = page.getByRole("slider", { name: "Hue range end" });
    await endThumb.scrollIntoViewIfNeeded();
    const box = await endThumb.boundingBox();
    const ring = await page.getByRole("button", { name: "Select a hue range" }).boundingBox();

    const centerX = (ring?.x ?? 0) + (ring?.width ?? 0) / 2;
    const centerY = (ring?.y ?? 0) + (ring?.height ?? 0) / 2;

    await page.mouse.move((box?.x ?? 0) + 10, (box?.y ?? 0) + 10);
    await page.mouse.down();
    // Drag round to roughly 180° — the bottom of the ring.
    await page.mouse.move(centerX, centerY + 80, { steps: 12 });
    await page.mouse.up();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/hueMin=0/);
    await expect(page).toHaveURL(/hueMax=1[6-9]\d|hueMax=200/);
  });

  test("the arc does not flicker back to its old value on release", async ({ page }) => {
    await page.goto("/?category=color&hueMin=0&hueMax=60");
    await page.waitForLoadState("networkidle");

    // Scoped to the ring's own section, so the assertion is pinned to the
    // readout under test rather than to whatever else prints a degree.
    const readout = page
      .locator("section")
      .filter({ has: page.getByRole("button", { name: "Select a hue range" }) })
      .getByText(/\d+° – \d+°/);
    await expect(readout).toContainText("0° – 60°");

    const endThumb = page.getByRole("slider", { name: "Hue range end" });
    await endThumb.scrollIntoViewIfNeeded();
    const box = await endThumb.boundingBox();
    const ring = await page.getByRole("button", { name: "Select a hue range" }).boundingBox();

    await page.mouse.move((box?.x ?? 0) + 10, (box?.y ?? 0) + 10);
    await page.mouse.down();
    await page.mouse.move(
      (ring?.x ?? 0) + (ring?.width ?? 0) - 6,
      (ring?.y ?? 0) + (ring?.height ?? 0) / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    // Sample immediately after release: the old bug showed the pre-drag value
    // for a frame before the new one landed.
    const samples: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      samples.push((await readout.textContent()) ?? "");
      await page.waitForTimeout(16);
    }

    expect(samples.some((text) => text.includes("0° – 60°"))).toBe(false);
  });

  test("the saturation ramp follows the hue mid-drag", async ({ page }) => {
    await page.goto("/?category=color&hueMin=0&hueMax=60");
    await page.waitForLoadState("networkidle");

    // The saturation track. Its gradient is written in `hsl()` and serialized
    // back as `rgb()`, so the assertion is that it moves, not what it says.
    const ramp = page.locator("[style*='linear-gradient']").first();
    const before = await ramp.getAttribute("style");

    const startThumb = page.getByRole("slider", { name: "Hue range start" });
    await startThumb.scrollIntoViewIfNeeded();
    const box = await startThumb.boundingBox();
    const ring = await page.getByRole("button", { name: "Select a hue range" }).boundingBox();

    await page.mouse.move((box?.x ?? 0) + 10, (box?.y ?? 0) + 10);
    await page.mouse.down();
    // Round to the bottom of the ring — the cyans — and stop there, held.
    await page.mouse.move(
      (ring?.x ?? 0) + (ring?.width ?? 0) / 2,
      (ring?.y ?? 0) + (ring?.height ?? 0) - 6,
      { steps: 12 },
    );

    // Still holding: the URL has not moved yet, but the ramp must have.
    await expect.poll(() => ramp.getAttribute("style")).not.toBe(before);
    await expect(page).toHaveURL(/hueMin=0&hueMax=60/);

    await page.mouse.up();
  });
});

test.describe("range sliders", () => {
  test("dragging the price slider narrows the results", async ({ page }) => {
    await sectionToggle(page, "Price").scrollIntoViewIfNeeded();

    const minThumb = page.getByRole("slider", { name: /Price, minimum/ });
    const box = await minThumb.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move((box?.x ?? 0) + 4, (box?.y ?? 0) + 4);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + 90, (box?.y ?? 0) + 4, { steps: 10 });
    await page.mouse.up();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/priceMin=\d+/);
  });

  test("the keyboard moves a thumb", async ({ page }) => {
    const minThumb = page.getByRole("slider", { name: /Saturation, minimum/ });
    await minThumb.scrollIntoViewIfNeeded();
    await minThumb.focus();

    await page.keyboard.press("ArrowRight");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/saturationMin=1/);
  });
});

test.describe("sections collapse", () => {
  test("a section hides its contents and keeps its summary", async ({ page }) => {
    const chroma = rail(page).getByRole("checkbox", { name: /Chroma Labs/ });
    await chroma.click();
    await expect(chroma).toBeChecked();
    await expect(page.getByText(/1 chosen/)).toBeVisible();

    await sectionToggle(page, "Foundry").click();

    await expect(
      rail(page).getByRole("checkbox", { name: /Chroma Labs/ }),
    ).toBeHidden();
    // The badge survives collapsing, so the filter is still discoverable.
    await expect(page.getByText(/1 chosen/)).toBeVisible();
  });
});

test.describe("pagination", () => {
  test("turning the page returns to the top", async ({ page }) => {
    const next = page.getByRole("button", { name: "Next" });

    await next.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await next.click();
    await expect(page).toHaveURL(/page=2/);

    // Otherwise page 2 opens at the bottom of a grid you have not seen.
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(0);
  });
});

test.describe("search", () => {
  test("finds a term inside a word", async ({ page }) => {
    await searchBox(page).fill("owder");
    await searchBox(page).press("Enter");
    await page.waitForLoadState("networkidle");

    // "owder" is inside "Powdered" — full-text alone could never find it.
    await expect(page.getByRole("link", { name: /Powdered/ }).first()).toBeVisible();
  });

  test("a color family typed in the plural selects that family", async ({ page }) => {
    await searchBox(page).fill("golds");
    await searchBox(page).press("Enter");
    await page.waitForLoadState("networkidle");

    // Nothing is filed under "gold". The word is a landmark in RGB space, and
    // the colors nearest to it are the answer.
    await expect(page).toHaveURL(/family=gold/);
    // Only a color has a family, so the word picks the shelf as well.
    await expect(page).toHaveURL(/category=color/);
    await expect(page.getByText("Nothing matches that.")).toBeHidden();
    await expect(results(page).getByRole("article").first()).toBeVisible();
  });

  test("a direction goes to the shifters that turn that way", async ({ page }) => {
    await searchBox(page).fill("clock-wise");
    await searchBox(page).press("Enter");
    await page.waitForLoadState("networkidle");

    // Only a shifter turns, so the word picks the shelf as well as the way.
    await expect(page).toHaveURL(/category=shifter/);
    await expect(page).toHaveURL(/direction=cw/);
    await expect(results(page).getByRole("article").first()).toBeVisible();
  });

  test("a finish name goes to the finishers that apply it", async ({ page }) => {
    // A finish is a thing a shopper buys, so the name of one is a shelf rather
    // than a search through the prose.
    await searchBox(page).fill("gloss");
    await searchBox(page).press("Enter");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/category=finisher/);
    // The name is the filter now, rather than a stretch of an axis it has to
    // be translated into.
    await expect(page).toHaveURL(/finish=gloss/);
    await expect(rail(page).getByRole("radio", { name: /^Gloss/ })).toBeChecked();
  });

  test("the family a search landed on can be cleared again", async ({ page }) => {
    await searchBox(page).fill("teal");
    await searchBox(page).press("Enter");
    await page.waitForLoadState("networkidle");

    // The rail has no family section, so the active one is shown above the
    // results — otherwise a search for a color family is a one-way door.
    const clear = results(page).getByRole("button", { name: /Clear this color family/ });
    await expect(clear).toContainText("teal");

    await clear.click();
    await expect(page).not.toHaveURL(/family=/);
  });

  test("suggests as you type", async ({ page }) => {
    await searchBox(page).fill("munic");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option").first()).toContainText(/Municipal/);
  });
});
