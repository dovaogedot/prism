/**
 * API integration tests for the catalog: search, facets, sorting, and the
 * database-derived values the application is forbidden from writing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hslToHex } from "../../src/db/palette.ts";
import {
  jsonOf,
  seedCatalog,
  seedInstruments,
  startHarness,
  type Harness,
} from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
});

const get = (url: string) => harness.app.inject({ method: "GET", url });

const COLORS = [
  { slug: "screaming-pumpkin", name: "Screaming Pumpkin", hex: "#ff8800", priceCents: 1899, finish: "gloss" },
  { slug: "municipal-beige", name: "Municipal Beige", hex: "#d8c8a8", priceCents: 899, finish: "matte" },
  { slug: "void-black", name: "Void Black", hex: "#050505", priceCents: 4999, finish: "matte" },
  { slug: "cathedral-moss", name: "Cathedral Moss", hex: "#4a7c40", priceCents: 2400, finish: "iridescent" },
];

describe("derived values", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
  });

  it("derives hue, saturation and lightness from the stored hex", async () => {
    const response = await get("/api/v1/products/screaming-pumpkin");
    const body = jsonOf(response);

    // #ff8800 is hsl(32, 100%, 50%). Nothing wrote these columns.
    expect(body["spec"]).toMatchObject({
      kind: "color",
      hex: "#ff8800",
      finish: "gloss",
      hue: 32,
      saturation: 100,
      lightness: 50,
    });
  });

  it("agrees with the TypeScript conversion in the opposite direction", async () => {
    // hslToHex composes a color; the SQL functions take it apart again.
    // Round-tripping the two catches a drift in either.
    const response = await get("/api/v1/products/cathedral-moss");
    const spec = jsonOf(response)["spec"] as Record<string, number>;

    const rebuilt = hslToHex(
      Number(spec["hue"]),
      Number(spec["saturation"]),
      Number(spec["lightness"]),
    );

    const channelsOf = (hex: string) =>
      [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

    const original = channelsOf("#4a7c40");
    const derived = channelsOf(rebuilt);

    for (let index = 0; index < 3; index += 1) {
      // Both directions round to integers, so one unit of slack is expected.
      expect(Math.abs((original[index] ?? 0) - (derived[index] ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it("refuses to let the application write a generated column", async () => {
    await expect(
      harness.database.sql`UPDATE product SET hue = 999 WHERE slug = 'void-black'`,
    ).rejects.toThrow();
  });

  it("returns both unit systems from one derived set of measurements", async () => {
    // Void Black is #050505: achromatic, so saturation is 0 and the
    // temperature collapses to the 6000 K neutral point. Lightness 2% makes it
    // nearly the heaviest a color can look, and matte gives it the shortest
    // reach of the four finishes.
    const body = jsonOf(await get("/api/v1/products/void-black"));

    expect(body["measurements"]).toEqual({
      of: "color",
      metric: {
        // Kelvin is what the column holds and what these two come from; it is
        // not a number the shop shows anyone.
        temperatureCelsius: 5726.9,
        reachMeters: 4,
        weightGrams: 236,
      },
      imperial: {
        temperatureFahrenheit: 10340.3,
        reachFeet: 13.1,
        weightOunces: 8.32,
      },
    });
  });

  it("measures a saturated color warmer, further and lighter", async () => {
    // Screaming Pumpkin is #ff8800 — hue 32°, saturation 100%, lightness 50%.
    const pumpkin = jsonOf(await get("/api/v1/products/screaming-pumpkin"))[
      "measurements"
    ] as Record<string, Record<string, number>>;
    const black = jsonOf(await get("/api/v1/products/void-black"))[
      "measurements"
    ] as Record<string, Record<string, number>>;

    // Orange is the warm end of the wheel, so it sits well below the neutral
    // 6000 K — kelvin runs backwards from how the word "warm" is used.
    expect(pumpkin["metric"]?.["temperatureCelsius"]).toBeLessThan(2727);
    // Fully saturated and gloss, against achromatic and matte.
    expect(pumpkin["metric"]?.["reachMeters"]).toBeGreaterThan(300);
    // Mid lightness against near-black.
    expect(pumpkin["metric"]?.["weightGrams"]).toBeLessThan(
      black["metric"]?.["weightGrams"] ?? 0,
    );
  });

  it("carries the whole tag chain, outermost first", async () => {
    const { sql } = harness.database;

    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'crimson', 'Crimson', 'color', id FROM category WHERE slug = 'reds'
    `;
    await sql`
      UPDATE product SET category_id = (SELECT id FROM category WHERE slug = 'crimson')
      WHERE slug = 'void-black'
    `;
    harness.clock.advanceSeconds(harness.config.cache.productTtlSeconds + 1);

    // Only the leaf used to come back, so the product page showed "Crimson"
    // while its card in the grid showed "Reds › Crimson".
    expect(jsonOf(await get("/api/v1/products/void-black"))["tags"]).toEqual([
      { slug: "reds", name: "Reds" },
      { slug: "crimson", name: "Crimson" },
    ]);
  });

  it("gives a root category a chain of one", async () => {
    expect(jsonOf(await get("/api/v1/products/void-black"))["tags"]).toEqual([
      { slug: "reds", name: "Reds" },
    ]);
  });

  it("refuses to let the application write a measurement", async () => {
    // The same guarantee hue and saturation have: these are GENERATED, so a
    // displayed measurement cannot drift from the hex it came from.
    await expect(
      harness.database.sql`UPDATE product SET weight_grams = 1 WHERE slug = 'void-black'`,
    ).rejects.toThrow();

    await expect(
      harness.database
        .sql`UPDATE product SET temperature_kelvin = 1 WHERE slug = 'void-black'`,
    ).rejects.toThrow();
  });
});

describe("ratings come from the reviews table", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
  });

  it("reports zero when nothing has been reviewed", async () => {
    const body = jsonOf(await get("/api/v1/products/void-black"));
    expect(body["rating"]).toEqual({ average: 0, count: 0 });
  });

  it("averages the reviews that exist", async () => {
    const { sql } = harness.database;

    await sql`INSERT INTO app_user (email, password_hash) VALUES ('r1@example.com', 'x'), ('r2@example.com', 'x')`;
    await sql`
      INSERT INTO product_review (product_id, user_id, rating)
      SELECT p.id, u.id, 5 FROM product p, app_user u
      WHERE p.slug = 'void-black' AND u.email = 'r1@example.com'
    `;
    await sql`
      INSERT INTO product_review (product_id, user_id, rating)
      SELECT p.id, u.id, 4 FROM product p, app_user u
      WHERE p.slug = 'void-black' AND u.email = 'r2@example.com'
    `;

    // Product detail is cached for 60s and an earlier read in this file warmed
    // it. Reviews are written directly here because project 1 has no review
    // endpoint to invalidate through, so step past the TTL instead.
    harness.clock.advanceSeconds(harness.config.cache.productTtlSeconds + 1);

    const body = jsonOf(await get("/api/v1/products/void-black"));

    expect(body["rating"]).toEqual({ average: 4.5, count: 2 });
  });

  it("follows a deleted review down again", async () => {
    const { sql } = harness.database;

    await sql`INSERT INTO app_user (email, password_hash) VALUES ('r1@example.com', 'x')`;
    await sql`
      INSERT INTO product_review (product_id, user_id, rating)
      SELECT p.id, u.id, 5 FROM product p, app_user u
      WHERE p.slug = 'void-black' AND u.email = 'r1@example.com'
    `;
    await sql`DELETE FROM product_review`;
    harness.clock.advanceSeconds(harness.config.cache.productTtlSeconds + 1);

    // A stored rating_avg column would still be showing 5.0 here.
    const body = jsonOf(await get("/api/v1/products/void-black"));
    expect(body["rating"]).toEqual({ average: 0, count: 0 });
  });
});

describe("GET /products", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
  });

  it("returns everything with no filters", async () => {
    const body = jsonOf(await get("/api/v1/products"));
    expect(body["total"]).toBe(4);
  });

  it("finds a color by a word in its name", async () => {
    const body = jsonOf(await get("/api/v1/products?q=screaming"));
    expect(body["total"]).toBe(1);
  });

  it("matches on the foundry name as well as the color", async () => {
    const body = jsonOf(await get("/api/v1/products?q=chroma"));
    expect(body["total"]).toBe(4);
  });

  it("finds a term inside a word, not just as a whole word", async () => {
    // "pumpkin" is a word in "Screaming Pumpkin", so full-text finds it. "umpk"
    // is not a word anywhere, and only the substring match can.
    const whole = jsonOf(await get("/api/v1/products?q=pumpkin"));
    const partial = jsonOf(await get("/api/v1/products?q=umpk"));

    expect(whole["total"]).toBe(1);
    expect(partial["total"]).toBe(1);
  });

  it("ranks a literal name hit above a description-only match", async () => {
    const body = jsonOf(await get("/api/v1/products?q=moss&sort=relevance"));
    const items = Array.isArray(body["items"]) ? body["items"] : [];

    // Cathedral Moss has it in the name; anything else matched on prose.
    expect((items[0] as Record<string, unknown>)["slug"]).toBe("cathedral-moss");
  });

  it("finds the colors under a parent category by its name", async () => {
    const { sql } = harness.database;

    // Nothing sits directly in "Reds" any more, only in "Reds → Crimsons".
    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'crimsons', 'Crimsons', 'color', id FROM category WHERE slug = 'reds'
    `;
    await sql`
      UPDATE product SET category_id = (SELECT id FROM category WHERE slug = 'crimsons')
    `;

    // Matching a product against its own category alone would return nothing
    // here, even though the typeahead offers "Reds" as a suggestion.
    const parent = jsonOf(await get("/api/v1/products?q=reds"));
    const child = jsonOf(await get("/api/v1/products?q=crimsons"));

    expect(parent["total"]).toBe(COLORS.length);
    expect(child["total"]).toBe(COLORS.length);
  });

  it("agrees with the category filter about what a category contains", async () => {
    const { sql } = harness.database;

    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'crimsons', 'Crimsons', 'color', id FROM category WHERE slug = 'reds'
    `;
    await sql`
      UPDATE product SET category_id = (SELECT id FROM category WHERE slug = 'crimsons')
      WHERE slug = 'void-black'
    `;

    const searched = jsonOf(await get("/api/v1/products?q=reds"));
    const filtered = jsonOf(await get("/api/v1/products?tag=reds"));

    expect(searched["total"]).toBe(filtered["total"]);
  });

  it("treats a LIKE metacharacter as a character, not a wildcard", async () => {
    // If % were passed through unescaped this would match the whole catalog.
    const body = jsonOf(await get("/api/v1/products?q=%25"));
    expect(body["total"]).toBe(0);
  });

  it("filters by a lightness range", async () => {
    // Void Black is around 2%, Municipal Beige around 75%.
    const dark = jsonOf(await get("/api/v1/products?lightnessMin=0&lightnessMax=20"));
    const light = jsonOf(await get("/api/v1/products?lightnessMin=60&lightnessMax=100"));

    const slugs = (body: Record<string, unknown>) =>
      (Array.isArray(body["items"]) ? body["items"] : []).map(
        (item: Record<string, unknown>) => item["slug"],
      );

    expect(slugs(dark)).toContain("void-black");
    expect(slugs(dark)).not.toContain("municipal-beige");
    expect(slugs(light)).toContain("municipal-beige");
  });

  it("sorts by price in both directions", async () => {
    const ascending = jsonOf(await get("/api/v1/products?sort=price_asc"));
    const descending = jsonOf(await get("/api/v1/products?sort=price_desc"));

    const prices = (body: Record<string, unknown>) =>
      (Array.isArray(body["items"]) ? body["items"] : []).map(
        (item: Record<string, unknown>) => item["priceCents"],
      );

    expect(prices(ascending)).toEqual([899, 1899, 2400, 4999]);
    expect(prices(descending)).toEqual([4999, 2400, 1899, 899]);
  });

  it("filters by a price range", async () => {
    const body = jsonOf(await get("/api/v1/products?priceMin=1000&priceMax=3000"));
    expect(body["total"]).toBe(2);
  });

  it("filters by finish", async () => {
    const body = jsonOf(await get("/api/v1/products?finishes=matte"));
    expect(body["total"]).toBe(2);
  });

  it("filters by an ordinary hue interval", async () => {
    // Cathedral Moss is around 110 degrees.
    const body = jsonOf(await get("/api/v1/products?hueMin=90&hueMax=150"));
    expect(body["total"]).toBe(1);
  });

  it("filters by a hue arc that wraps through zero", async () => {
    const { sql } = harness.database;
    await sql`
      INSERT INTO product (slug, name, description, price_cents, category_id, brand_id, kind, hex, finish)
      SELECT 'crimson', 'Crimson', 'red', 1000, c.id, b.id, 'color', '#e01020', 'matte'
      FROM category c, brand b WHERE c.slug = 'reds' AND b.slug = 'chroma-labs'
    `;

    // 350 -> 20 is the arc containing the reds, not an empty selection.
    const wrapped = jsonOf(await get("/api/v1/products?hueMin=350&hueMax=40"));
    const slugs = (Array.isArray(wrapped["items"]) ? wrapped["items"] : []).map(
      (item: Record<string, unknown>) => item["slug"],
    );

    expect(slugs).toContain("crimson");
    expect(slugs).toContain("screaming-pumpkin");
    expect(slugs).not.toContain("cathedral-moss");
  });

  it("pages without losing or repeating an item", async () => {
    const first = jsonOf(await get("/api/v1/products?perPage=2&page=1&sort=price_asc"));
    const second = jsonOf(await get("/api/v1/products?perPage=2&page=2&sort=price_asc"));

    const slugsOf = (body: Record<string, unknown>) =>
      (Array.isArray(body["items"]) ? body["items"] : []).map(
        (item: Record<string, unknown>) => item["slug"],
      );

    expect(first["totalPages"]).toBe(2);
    expect(slugsOf(first)).toHaveLength(2);
    expect(new Set([...slugsOf(first), ...slugsOf(second)]).size).toBe(4);
  });

  it("returns an empty page rather than an error when nothing matches", async () => {
    const body = jsonOf(await get("/api/v1/products?q=nosuchcolorexists"));

    expect(body["total"]).toBe(0);
    expect(body["items"]).toEqual([]);
  });
});

describe("facets", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
  });

  it("returns every dimension", async () => {
    const facets = jsonOf(await get("/api/v1/products"))["facets"];

    expect(Object.keys(facets as object).sort()).toEqual([
      "brands",
      "categories",
      "finishes",
      "priceCents",
      "ratings",
      "tags",
    ]);
  });

  it("counts finishes correctly", async () => {
    const body = jsonOf(await get("/api/v1/products"));
    const facets = body["facets"] as Record<string, unknown>;
    const finishes = facets["finishes"] as readonly Record<string, unknown>[];

    expect(finishes.find((bucket) => bucket["value"] === "matte")?.["count"]).toBe(2);
  });

  it("keeps a bucket that matches nothing, with a count of zero", async () => {
    const { sql } = harness.database;

    // A second foundry that stocks nothing in this filter's reach.
    await sql`INSERT INTO brand (slug, name) VALUES ('empty-foundry', 'Empty Foundry')`;

    const body = jsonOf(await get("/api/v1/products?finishes=matte"));
    const facets = body["facets"] as Record<string, unknown>;
    const brands = facets["brands"] as readonly Record<string, unknown>[];

    // Removing it would make the rail reflow under the pointer every time a
    // box is ticked.
    const empty = brands.find((bucket) => bucket["value"] === "empty-foundry");

    expect(empty).toBeDefined();
    expect(empty?.["count"]).toBe(0);
  });

  it("returns every finish and rating tier even when empty", async () => {
    const body = jsonOf(await get("/api/v1/products?q=nosuchcolorexists"));
    const facets = body["facets"] as Record<string, unknown>;

    expect((facets["finishes"] as readonly unknown[]).length).toBe(4);
    // Five tiers: 5, 4, 3, 2 and 1 stars.
    expect((facets["ratings"] as readonly unknown[]).length).toBe(5);

    for (const bucket of facets["finishes"] as readonly Record<string, unknown>[]) {
      expect(bucket["count"]).toBe(0);
    }
  });

  it("includes parent categories, counted over their whole subtree", async () => {
    const { sql } = harness.database;

    // Give "reds" a child and file a color under it.
    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'crimsons', 'Crimsons', 'color', id FROM category WHERE slug = 'reds'
    `;
    await sql`
      UPDATE product SET category_id = (SELECT id FROM category WHERE slug = 'crimsons')
      WHERE slug = 'void-black'
    `;

    const facets = jsonOf(await get("/api/v1/products"))["facets"] as Record<
      string,
      unknown
    >;
    const buckets = facets["tags"] as readonly Record<string, unknown>[];

    const parent = buckets.find((bucket) => bucket["value"] === "reds");
    const child = buckets.find((bucket) => bucket["value"] === "crimsons");

    // A parent must be selectable — the search suggestions offer one — and its
    // count covers everything beneath it.
    expect(parent?.["depth"]).toBe(0);
    expect(child?.["depth"]).toBe(1);
    expect(parent?.["count"]).toBe(COLORS.length);
    expect(child?.["count"]).toBe(1);
  });

  it("counts tags correctly while another filter is active", async () => {
    // The subtree query joins the listing view without an alias so the shared
    // condition builder's column references resolve. Aliasing it made this
    // 500 — but only once a filter was applied, so an unfiltered check passed.
    const response = await get("/api/v1/products?minRating=1");

    expect(response.statusCode).toBe(200);
    expect(
      (jsonOf(response)["facets"] as Record<string, unknown>)["tags"],
    ).toBeDefined();
  });

  it("offers a top rating tier that is selectable", async () => {
    const { sql } = harness.database;

    await sql`INSERT INTO app_user (email, password_hash) VALUES ('r@example.com', 'x')`;
    await sql`
      INSERT INTO product_review (product_id, user_id, rating)
      SELECT p.id, u.id, 5 FROM product p, app_user u
      WHERE p.slug = 'void-black' AND u.email = 'r@example.com'
    `;
    harness.clock.advanceSeconds(harness.config.cache.facetTtlSeconds + 1);

    const facets = jsonOf(await get("/api/v1/products"))["facets"] as Record<
      string,
      unknown
    >;
    const tiers = facets["ratings"] as readonly Record<string, unknown>[];
    const top = tiers.find((tier) => tier["value"] === "5");

    // Without a 5 tier the top star has no count and renders disabled.
    expect(top).toBeDefined();
    expect(top?.["count"]).toBe(1);
    expect(top?.["label"]).toBe("5 stars");

    // And nothing rates above five, so the filter is an exact match.
    const exact = jsonOf(await get("/api/v1/products?minRating=5"));
    expect(exact["total"]).toBe(1);
  });

  it("reports price extents from the whole catalog, not the filtered set", async () => {
    // Otherwise the price slider's endpoints move as it is dragged.
    const all = jsonOf(await get("/api/v1/products"));
    const filtered = jsonOf(await get("/api/v1/products?finishes=matte"));

    const bounds = (body: Record<string, unknown>) =>
      (body["facets"] as Record<string, unknown>)["priceCents"];

    expect(bounds(filtered)).toEqual(bounds(all));
  });

  it("keeps other finishes visible while one is selected", async () => {
    // This is the whole reason facet counts exclude their own dimension:
    // otherwise multi-select can only ever narrow to nothing.
    const body = jsonOf(await get("/api/v1/products?finishes=matte"));
    const facets = body["facets"] as Record<string, unknown>;
    const finishes = facets["finishes"] as readonly Record<string, unknown>[];

    expect(body["total"]).toBe(2);
    expect(finishes.find((bucket) => bucket["value"] === "gloss")?.["count"]).toBe(1);
  });

  it("reports the price extents of the filtered set", async () => {
    const facets = jsonOf(await get("/api/v1/products"))["facets"] as Record<string, unknown>;

    expect(facets["priceCents"]).toEqual({ min: 899, max: 4999 });
  });
});

describe("the three categories", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
    await seedInstruments(harness);
  });

  it("gives each kind its own spec and nothing of the others'", async () => {
    const finisher = jsonOf(await get("/api/v1/products/test-applicator"));
    const shifter = jsonOf(await get("/api/v1/products/test-swing"));

    expect(finisher["spec"]).toEqual({
      kind: "finisher",
      finish: "gloss",
      durability: 12,
    });
    expect(shifter["spec"]).toEqual({
      kind: "shifter",
      direction: "ccw",
      arcDegrees: 120,
    });
  });

  it("measures each kind by what that kind actually has", async () => {
    // A tin of finisher has no temperature and no reach; a shifter has neither
    // and no grain either. What they share is a weight, because the
    // requirement names one and because everything in the shop has some.
    const metricOf = async (slug: string) =>
      Object.keys(
        (
          jsonOf(await get(`/api/v1/products/${slug}`))["measurements"] as Record<
            string,
            Record<string, number>
          >
        )["metric"] ?? {},
      ).sort();

    expect(await metricOf("void-black")).toEqual([
      "reachMeters",
      "temperatureCelsius",
      "weightGrams",
    ]);
    expect(await metricOf("test-applicator")).toEqual([
      "coverageSquareMeters",
      "grainMicrometers",
      "weightGrams",
    ]);
    expect(await metricOf("test-swing")).toEqual([
      "backlashMillimeters",
      "torqueNewtonMeters",
      "weightGrams",
    ]);
  });

  it("gives every kind a weight and a dimension in both systems", async () => {
    // TASK.md asks for both systems on every product, so no kind may have none.
    for (const slug of ["void-black", "test-applicator", "test-swing"]) {
      const measurements = jsonOf(await get(`/api/v1/products/${slug}`))[
        "measurements"
      ] as Record<string, Record<string, number>>;

      expect(measurements["metric"]?.["weightGrams"]).toBeGreaterThan(0);
      expect(measurements["imperial"]?.["weightOunces"]).toBeGreaterThan(0);
      expect(Object.keys(measurements["imperial"] ?? {})).toHaveLength(3);
    }
  });

  it("gives a counter-clockwise shifter more backlash than a clockwise one", async () => {
    // Every shifter ever built was cut for clockwise. Going the other way takes
    // up the slack on the wrong face of the tooth, and it is the one number
    // that genuinely differs by direction.
    const { sql } = harness.database;

    await sql`
      INSERT INTO product (
        slug, name, description, price_cents, category_id, brand_id,
        kind, arc_degrees, direction
      )
      SELECT 'test-swing-cw', 'Test Swing CW', 'The other way.', 6900, c.id, b.id,
             'shifter', 120, 'cw'
      FROM category c, brand b WHERE c.slug = 'shifter' AND b.slug = 'chroma-labs'
    `;

    const metric = async (slug: string, key: string) =>
      (
        jsonOf(await get(`/api/v1/products/${slug}`))["measurements"] as Record<
          string,
          Record<string, number>
        >
      )["metric"]?.[key];

    expect(await metric("test-swing", "backlashMillimeters")).toBeGreaterThan(
      (await metric("test-swing-cw", "backlashMillimeters")) ?? 0,
    );

    // The arc is the same on both, so the torque must be too.
    expect(await metric("test-swing", "torqueNewtonMeters")).toBe(
      await metric("test-swing-cw", "torqueNewtonMeters"),
    );
  });

  it("filters by category", async () => {
    expect(jsonOf(await get("/api/v1/products"))["total"]).toBe(COLORS.length + 2);
    expect(jsonOf(await get("/api/v1/products?category=color"))["total"]).toBe(
      COLORS.length,
    );
    expect(jsonOf(await get("/api/v1/products?category=finisher"))["total"]).toBe(1);
    expect(jsonOf(await get("/api/v1/products?category=shifter"))["total"]).toBe(1);
  });

  it("filters shifters by arc and direction", async () => {
    const totalOf = async (query: string) =>
      jsonOf(await get(`/api/v1/products?category=shifter&${query}`))["total"];

    expect(await totalOf("arcMin=100&arcMax=200")).toBe(1);
    expect(await totalOf("arcMin=200&arcMax=300")).toBe(0);
    expect(await totalOf("direction=ccw")).toBe(1);
    expect(await totalOf("direction=cw")).toBe(0);
  });

  it("counts all three categories whatever else is filtered", async () => {
    // A kind-specific filter must not zero the other categories: no color has
    // an arc, so counting colors against one would answer a question the
    // shopper never asked. Switching category clears those filters anyway.
    const facets = jsonOf(
      await get("/api/v1/products?category=shifter&arcMin=100&direction=ccw"),
    )["facets"] as Record<string, unknown>;

    const categories = facets["categories"] as readonly Record<string, unknown>[];
    const countOf = (value: string) =>
      categories.find((bucket) => bucket["value"] === value)?.["count"];

    expect(categories).toHaveLength(3);
    expect(countOf("color")).toBe(COLORS.length);
    expect(countOf("finisher")).toBe(1);
    expect(countOf("shifter")).toBe(1);
  });

  it("keeps tags out of the category facet and categories out of the tags", async () => {
    const facets = jsonOf(await get("/api/v1/products"))["facets"] as Record<
      string,
      unknown
    >;

    const categories = (facets["categories"] as readonly Record<string, string>[]).map(
      (bucket) => bucket["value"],
    );
    const tags = (facets["tags"] as readonly Record<string, string>[]).map(
      (bucket) => bucket["value"],
    );

    expect(categories).toEqual(["color", "finisher", "shifter"]);
    expect(tags).toEqual(["reds"]);
  });

  it("refuses a product carrying another variant's columns", async () => {
    // The database rejects it, so no code path has to remember to.
    await expect(
      harness.database.sql`
        INSERT INTO product (
          slug, name, description, price_cents, category_id, brand_id,
          kind, hex, arc_degrees, direction
        )
        SELECT 'impossible', 'Impossible', 'x', 100, c.id, b.id,
               'shifter', '#ff0000', 90, 'cw'
        FROM category c, brand b WHERE c.slug = 'shifter' AND b.slug = 'chroma-labs'
      `,
    ).rejects.toThrow();
  });

  it("refuses a product filed outside its own category", async () => {
    await expect(
      harness.database.sql`
        INSERT INTO product (
          slug, name, description, price_cents, category_id, brand_id,
          kind, hex, finish
        )
        SELECT 'misfiled', 'Misfiled', 'x', 100, c.id, b.id, 'color', '#ff0000', 'matte'
        FROM category c, brand b WHERE c.slug = 'shifter' AND b.slug = 'chroma-labs'
      `,
    ).rejects.toThrow();
  });
});

describe("GET /products/suggest", () => {
  beforeEach(async () => {
    await seedCatalog(harness, COLORS);
  });

  it("suggests on a partial word, before it is a whole word", async () => {
    const body = JSON.parse((await get("/api/v1/products/suggest?q=screa")).body);

    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toMatchObject({ kind: "product", slug: "screaming-pumpkin" });
  });

  it("carries the swatch color for products", async () => {
    const body = JSON.parse((await get("/api/v1/products/suggest?q=screa")).body);
    expect(body[0].hex).toEqual({ _tag: "Some", value: "#ff8800" });
  });

  it("requires a term", async () => {
    expect((await get("/api/v1/products/suggest?q=")).statusCode).toBe(422);
  });

  it("treats a quote as text, not syntax", async () => {
    expect((await get("/api/v1/products/suggest?q=o%27brien")).statusCode).toBe(200);
  });
});

describe("GET /categories", () => {
  it("nests children under their parent and counts the whole subtree", async () => {
    const { sql } = harness.database;

    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'reds', 'Reds', 'color', id FROM category WHERE slug = 'color'
    `;
    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'crimsons', 'Crimsons', 'color', id FROM category WHERE slug = 'reds'
    `;
    await sql`INSERT INTO brand (slug, name) VALUES ('chroma-labs', 'Chroma Labs')`;
    await sql`
      INSERT INTO product (slug, name, description, price_cents, category_id, brand_id, kind, hex, finish)
      SELECT 'deep-crimson', 'Deep Crimson', 'red', 1000, c.id, b.id, 'color', '#a00020', 'matte'
      FROM category c, brand b WHERE c.slug = 'crimsons' AND b.slug = 'chroma-labs'
    `;

    const tree = JSON.parse((await get("/api/v1/categories")).body);

    // The three categories are the roots; the taxonomy hangs beneath them.
    expect(tree.map((node: { slug: string }) => node.slug)).toEqual([
      "color",
      "finisher",
      "shifter",
    ]);

    const colors = tree[0];
    expect(colors.children[0].slug).toBe("reds");
    expect(colors.children[0].children[0].slug).toBe("crimsons");
    // The product sits two levels down, but every ancestor counts it.
    expect(colors.productCount).toBe(1);
    expect(colors.children[0].productCount).toBe(1);
    expect(colors.children[0].children[0].productCount).toBe(1);
  });

  it("refuses a subtree that mixes kinds", async () => {
    // The composite foreign key on (parent_id, kind) is what makes a category
    // the root of its own taxonomy: a shifter tag cannot be filed under Colors,
    // so no product can end up on a shelf its variant does not fit.
    await expect(
      harness.database.sql`
        INSERT INTO category (slug, name, kind, parent_id)
        SELECT 'wrong', 'Wrong', 'shifter', id FROM category WHERE slug = 'color'
      `,
    ).rejects.toThrow();
  });
});

describe("GET /products/:slug", () => {
  it("404s for a color that does not exist", async () => {
    const response = await get("/api/v1/products/no-such-color");

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });
});
