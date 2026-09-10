/**
 * API integration tests for the catalog: search, facets, sorting, and the
 * database-derived values the application is forbidden from writing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hslToHex } from "../../src/db/palette.ts";
import {
  insertProduct,
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

/**
 * Four colors. Every one has a roughness, because every surface does; one of
 * them also carries a coating, and is smooth because a coating needs a
 * reflection to happen in.
 */
const COLORS = [
  { slug: "screaming-pumpkin", name: "Screaming Pumpkin", hex: "#ff8800", priceCents: 1899, roughness: 18, coatingNanometers: 0, emission: 0 },
  { slug: "municipal-beige", name: "Municipal Beige", hex: "#d8c8a8", priceCents: 899, roughness: 88, coatingNanometers: 0, emission: 0 },
  { slug: "void-black", name: "Void Black", hex: "#050505", priceCents: 4999, roughness: 88, coatingNanometers: 0, emission: 0 },
  { slug: "cathedral-moss", name: "Cathedral Moss", hex: "#4a7c40", priceCents: 2400, roughness: 20, coatingNanometers: 300, emission: 0 },
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
      roughness: 18,
      coatingNanometers: 0,
      emission: 0,
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
    // nearly the heaviest a color can look, and a roughness of 88 with no glow
    // behind it gives it about the shortest reach a color can have.
    const body = jsonOf(await get("/api/v1/products/void-black"));

    expect(body["measurements"]).toEqual({
      of: "color",
      metric: {
        // Kelvin is what the column holds and what these two come from; it is
        // not a number the shop shows anyone.
        temperatureCelsius: 5726.9,
        reachMeters: 3.37,
        // Bare paint, which is a coating of no thickness at all.
        coatingNanometers: 0,
        weightGrams: 236,
      },
      imperial: {
        temperatureFahrenheit: 10340.3,
        reachFeet: 11.1,
        coatingMicroinches: 0,
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

  it("filters by roughness, which is a range and not a name", async () => {
    // Two of the four sit at 88; the other two are smoother.
    const body = jsonOf(await get("/api/v1/products?roughnessMin=80"));
    expect(body["total"]).toBe(2);
  });

  it("finds a color by any of the amounts it carries", async () => {
    const coated = jsonOf(await get("/api/v1/products?coatingMin=250"));
    // Two are under 40: the lacquered one, and the coated one — which is
    // smooth because a coating needs a reflection to happen in.
    const smooth = jsonOf(await get("/api/v1/products?roughnessMax=40"));

    expect(coated["total"]).toBe(1);
    expect(smooth["total"]).toBe(2);
  });

  it("narrows on one amount without saying anything about the others", async () => {
    // Every color has a roughness and only some have a coating, and a range on
    // one of them says nothing about the rest.
    const everything = jsonOf(await get("/api/v1/products?roughnessMin=5&roughnessMax=95"));
    const filmed = jsonOf(await get("/api/v1/products?coatingMin=100"));

    expect(everything["total"]).toBe(4);
    expect(filmed["total"]).toBe(1);
  });

  it("filters by an ordinary hue interval", async () => {
    // Cathedral Moss is around 110 degrees.
    const body = jsonOf(await get("/api/v1/products?hueMin=90&hueMax=150"));
    expect(body["total"]).toBe(1);
  });

  it("filters by a hue arc that wraps through zero", async () => {
    await insertProduct(harness, {
      kind: "color",
      slug: "crimson",
      name: "Crimson",
      priceCents: 1000,
      hex: "#e01020",
    });

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

  /**
   * Four finishers over the three finish words, two of them on the grain, so a
   * word that names a whole axis is seen counting more than one row. Seeded
   * inside the tests that need them so the counts in the rest of this block
   * stay about the colors.
   */
  const seedFinishers = async (): Promise<void> => {
    await insertProduct(harness, {
      kind: "finisher",
      applies: "roughness",
      roughness: 88,
      slug: "test-chalk",
      name: "Test Chalk",
      priceCents: 1000,
    });
    await insertProduct(harness, {
      kind: "finisher",
      applies: "roughness",
      roughness: 18,
      slug: "test-lacquer",
      name: "Test Lacquer",
      priceCents: 1100,
    });
    await insertProduct(harness, {
      kind: "finisher",
      applies: "coating",
      coatingNanometers: 300,
      slug: "test-film",
      name: "Test Film",
      priceCents: 1200,
    });
    await insertProduct(harness, {
      kind: "finisher",
      applies: "emission",
      emission: 80,
      slug: "test-lamp",
      name: "Test Lamp",
      priceCents: 1300,
    });
  };

  it("returns every dimension", async () => {
    const facets = jsonOf(await get("/api/v1/products"))["facets"];

    expect(Object.keys(facets as object).sort()).toEqual([
      "brands",
      "categories",
      "finishes",
      "priceCents",
      "ratings",
    ]);
  });

  it("keeps a bucket that matches nothing, with a count of zero", async () => {
    const { sql } = harness.database;

    // A second foundry that stocks nothing in this filter's reach.
    await sql`INSERT INTO brand (slug, name) VALUES ('empty-foundry', 'Empty Foundry')`;

    const body = jsonOf(await get("/api/v1/products?roughnessMin=80"));
    const facets = body["facets"] as Record<string, unknown>;
    const brands = facets["brands"] as readonly Record<string, unknown>[];

    // Removing it would make the rail reflow under the pointer every time a
    // box is ticked.
    const empty = brands.find((bucket) => bucket["value"] === "empty-foundry");

    expect(empty).toBeDefined();
    expect(empty?.["count"]).toBe(0);
  });

  const finishCounts = async (query: string) => {
    const facets = jsonOf(await get(`/api/v1/products${query}`))["facets"] as Record<
      string,
      unknown
    >;

    return new Map(
      (facets["finishes"] as readonly Record<string, unknown>[]).map((bucket) => [
        bucket["value"],
        bucket["count"],
      ]),
    );
  };

  it("counts each finish over the finishers it names", async () => {
    // The three words name finishers, not colors: a finisher is bought for the
    // one effect it produces, so it has one answer to which finish it is, and
    // a word counts every finisher that moves the amount it names.
    await seedFinishers();
    const counts = await finishCounts("?category=finisher");

    expect(counts.get("roughness")).toBe(2);
    expect(counts.get("iridescent")).toBe(1);
    expect(counts.get("fluorescent")).toBe(1);
  });

  it("keeps every finish counted while one of them is selected", async () => {
    // Otherwise picking one would show the other three holding nothing, and
    // there would be no way to see what switching to one of them costs.
    await seedFinishers();
    const counts = await finishCounts("?category=finisher&finish=iridescent");

    expect(counts.get("roughness")).toBe(2);
    expect(counts.get("fluorescent")).toBe(1);
  });

  it("narrows a finisher shelf to a stretch of the amount its finish names", async () => {
    // A finisher is bought for how much of the one thing it does, so the shelf
    // has to be askable by that amount and not only by the word.
    await seedFinishers();

    const slugs = (
      jsonOf(
        await get(
          "/api/v1/products?category=finisher&finish=roughness&roughnessMin=50",
        ),
      )["items"] as readonly Record<string, unknown>[]
    ).map((item) => item["slug"]);

    expect(slugs).toEqual(["test-chalk"]);
  });

  it("counts every finish while a range on one of their amounts is applied", async () => {
    // The range belongs to the finish that is chosen. A finisher carries the
    // one amount its own finish is made of and nothing in the other two
    // columns, so counting the fluorescent ones against a roughness range
    // would answer zero and leave the shopper unable to switch away from it.
    await seedFinishers();
    const counts = await finishCounts(
      "?category=finisher&finish=roughness&roughnessMin=50",
    );

    expect(counts.get("roughness")).toBe(2);
    expect(counts.get("iridescent")).toBe(1);
    expect(counts.get("fluorescent")).toBe(1);
  });

  it("narrows to the finishers the finish names, and to no others", async () => {
    await seedFinishers();

    const slugsOf = async (finish: string) =>
      (
        jsonOf(await get(`/api/v1/products?category=finisher&finish=${finish}`))[
          "items"
        ] as readonly Record<string, unknown>[]
      )
        .map((item) => item["slug"])
        .sort();

    // Each word picks out the finishers that move the amount it names and no
    // others. A finisher that lays a coating carries no roughness at all, so
    // asking for the grain cannot answer with the whole shelf.
    expect(await slugsOf("roughness")).toEqual(["test-chalk", "test-lacquer"]);
    expect(await slugsOf("iridescent")).toEqual(["test-film"]);
    expect(await slugsOf("fluorescent")).toEqual(["test-lamp"]);
  });

  it("leaves the three words out of the color shelf, which has no answer to them", async () => {
    // A color carries all three amounts at once, so "which finish is it" has
    // no single answer for one. Colors are narrowed by the amounts instead,
    // each on its own axis, which is the test below.
    await seedFinishers();

    expect(
      jsonOf(await get("/api/v1/products?category=color&finish=roughness"))["total"],
    ).toBe(0);
  });

  it("narrows by each amount independently, and by several at once", async () => {
    // A surface carries all three, so asking about one says nothing about the
    // others: a shopper can ask for something lacquered that is also coated.
    const total = async (query: string) =>
      jsonOf(await get(`/api/v1/products?category=color&${query}`))["total"];

    expect(await total("roughnessMax=40")).toBe(2);
    expect(await total("coatingMin=100")).toBe(1);
    expect(await total("emissionMin=35")).toBe(0);

    // Both at once, rather than one replacing the other.
    expect(await total("roughnessMax=40&coatingMin=100")).toBe(1);
    expect(await total("roughnessMin=80&coatingMin=100")).toBe(0);
  });

  it("returns every rating tier even when empty", async () => {
    const body = jsonOf(await get("/api/v1/products?q=nosuchcolorexists"));
    const facets = body["facets"] as Record<string, unknown>;

    // Five tiers: 5, 4, 3, 2 and 1 stars.
    expect((facets["ratings"] as readonly unknown[]).length).toBe(5);

    for (const bucket of facets["ratings"] as readonly Record<string, unknown>[]) {
      expect(bucket["count"]).toBe(0);
    }
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
    const filtered = jsonOf(await get("/api/v1/products?roughnessMin=80"));

    const bounds = (body: Record<string, unknown>) =>
      (body["facets"] as Record<string, unknown>)["priceCents"];

    expect(bounds(filtered)).toEqual(bounds(all));
  });

  it("keeps other foundries visible while one is selected", async () => {
    // This is the whole reason facet counts exclude their own dimension:
    // otherwise multi-select can only ever narrow to nothing.
    const { sql } = harness.database;

    await sql`INSERT INTO brand (slug, name) VALUES ('cyan-and-sons', 'Cyan & Sons')`;
    await insertProduct(harness, {
      kind: "color",
      slug: "rival-red",
      name: "Rival Red",
      priceCents: 1500,
      stockQuantity: 4,
      brandSlug: "cyan-and-sons",
      hex: "#c02020",
      roughness: 40,
    });

    const body = jsonOf(await get("/api/v1/products?brands=chroma-labs"));
    const facets = body["facets"] as Record<string, unknown>;
    const brands = facets["brands"] as readonly Record<string, unknown>[];

    expect(body["total"]).toBe(4);
    expect(brands.find((bucket) => bucket["value"] === "cyan-and-sons")?.["count"]).toBe(1);
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

  it("carries a category that never disagrees with the spec's kind", async () => {
    // `category` is the name the catalog contract asks for a category by, and
    // `spec.kind` is the discriminant everything downstream matches on. They
    // are one fact under two names, so a page where they differ is a bug.
    const items = jsonOf(await get("/api/v1/products?perPage=60"))["items"];
    const rows = Array.isArray(items) ? items : [];

    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows as readonly Record<string, unknown>[]) {
      const spec = item["spec"] as Record<string, unknown>;
      expect(item["category"], String(item["slug"])).toBe(spec["kind"]);
    }

    // All three kinds are on that page, so the agreement is checked for each.
    expect(new Set(rows.map((item) => (item as Record<string, unknown>)["category"]))).toEqual(
      new Set(["color", "finisher", "shifter"]),
    );
  });

  it("leads the image list with the one it calls primary", async () => {
    // `primaryImage` is the first of `images`, so the two cannot name
    // different files. A kind that is drawn from its own spec has neither.
    await harness.database.sql`
      INSERT INTO product_image (product_id, filename, dark_filename, alt, position)
      SELECT p.id, ${`${"a".repeat(64)}.webp`}, ${`${"b".repeat(64)}.webp`},
             'Void Black, seen from the front', 0
      FROM product p WHERE p.slug = 'void-black'
    `;
    harness.clock.advanceSeconds(harness.config.cache.productTtlSeconds + 1);

    const color = jsonOf(await get("/api/v1/products/void-black"));
    const shifter = jsonOf(await get("/api/v1/products/test-swing"));

    const images = color["images"] as readonly Record<string, unknown>[];
    const primary = color["primaryImage"] as Record<string, unknown>;

    expect(images.length).toBeGreaterThan(0);
    expect(primary["_tag"]).toBe("Some");
    expect((primary["value"] as Record<string, unknown>)["url"]).toBe(images[0]?.["url"]);
    expect(images[0]?.["darkUrl"]).toBe(`/media/${"b".repeat(64)}.webp`);

    expect(shifter["images"]).toEqual([]);
    expect((shifter["primaryImage"] as Record<string, unknown>)["_tag"]).toBe("None");
  });

  it("gives each kind its own spec and nothing of the others'", async () => {
    const finisher = jsonOf(await get("/api/v1/products/test-applicator"));
    const shifter = jsonOf(await get("/api/v1/products/test-swing"));

    expect(finisher["spec"]).toEqual({
      kind: "finisher",
      applies: "roughness",
      roughness: 18,
    });
    expect(shifter["spec"]).toEqual({
      kind: "shifter",
      direction: "ccw",
      arcDegrees: 120,
    });
  });

  it("measures each kind by what that kind actually has", async () => {
    // A finisher has no temperature and no reach; a shifter has neither
    // and no grain either. What they share is a weight, because the
    // requirement names one and because everything in the shop has some.
    //
    // `applies` is dropped: it says which dimension a finisher quotes rather than
    // being a dimension of its own.
    const metricOf = async (slug: string) =>
      Object.keys(
        (
          jsonOf(await get(`/api/v1/products/${slug}`))["measurements"] as Record<
            string,
            Record<string, number>
          >
        )["metric"] ?? {},
      )
        .filter((key) => key !== "applies")
        .sort();

    expect(await metricOf("void-black")).toEqual([
      "coatingNanometers",
      "reachMeters",
      "temperatureCelsius",
      "weightGrams",
    ]);
    // One dimension, and it is the one this finisher's own effect has: it is sold
    // for the surface it leaves, so it quotes that surface's grain.
    expect(await metricOf("test-applicator")).toEqual([
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
      // Every metric row has an imperial counterpart, whatever the kind
      // measures and however many rows that turns out to be.
      expect(Object.keys(measurements["imperial"] ?? {})).toHaveLength(
        Object.keys(measurements["metric"] ?? {}).length,
      );
    }
  });

  it("gives a counter-clockwise shifter more backlash than a clockwise one", async () => {
    // Every shifter ever built was cut for clockwise. Going the other way takes
    // up the slack on the wrong face of the tooth, and it is the one number
    // that genuinely differs by direction.
    await insertProduct(harness, {
      kind: "shifter",
      slug: "test-swing-cw",
      name: "Test Swing CW",
      description: "The other way.",
      priceCents: 6900,
      direction: "cw",
      arcDegrees: 120,
    });

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

  it("refuses a variant row attached to a product of another kind", async () => {
    // The composite key is what a plain foreign key on `product_id` could not
    // say: this row is a color, so the product it belongs to must be one.
    const { sql } = harness.database;

    await sql`
      INSERT INTO product (slug, name, description, price_cents, brand_id, kind)
      SELECT 'impossible', 'Impossible', 'x', 100, b.id, 'shifter'
      FROM brand b WHERE b.slug = 'chroma-labs'
    `;

    await expect(
      sql`
        INSERT INTO color (product_id, hex, roughness, coating_nanometers, emission)
        SELECT p.id, '#ff0000', 88, 0, 0 FROM product p WHERE p.slug = 'impossible'
      `,
    ).rejects.toThrow();
  });

  it("refuses a coating over a surface with no reflection to show it", async () => {
    // Interference is something that happens to a reflection. A chalk surface
    // scatters its reflection away, so a coating over one is invisible.
    await expect(
      insertProduct(harness, {
        kind: "color",
        slug: "coated-chalk",
        name: "Coated Chalk",
        priceCents: 100,
        hex: "#4a4a4a",
        roughness: 90,
        coatingNanometers: 300,
      }),
    ).rejects.toThrow();
  });

  it("refuses a glow on a pigment with no band to glow in", async () => {
    // Fluorescence is absorption and re-emission inside a band. A gray has no
    // band, so a gray that glowed would just be going white.
    await expect(
      insertProduct(harness, {
        kind: "color",
        slug: "glowing-gray",
        name: "Glowing Gray",
        priceCents: 100,
        hex: "#9a9a9a",
        roughness: 40,
        emission: 90,
      }),
    ).rejects.toThrow();
  });

  it("lets a vivid pigment glow as hard as it likes", async () => {
    await expect(
      insertProduct(harness, {
        kind: "color",
        slug: "glowing-acid",
        name: "Glowing Acid",
        priceCents: 100,
        hex: "#d8f312",
        roughness: 40,
        emission: 100,
      }),
    ).resolves.toBeUndefined();
  });

  it("names a color's family from its hex, and nothing else", async () => {
    // Nothing files a color under a name: the same landmark set lives in
    // `color_family` and in `COLOR_FAMILIES`, and the nearest one wins.
    await insertProduct(harness, {
      kind: "color",
      slug: "leaf-gold",
      name: "Leaf Gold",
      priceCents: 100,
      hex: "#d4a017",
    });

    const rows = await harness.database
      .sql`SELECT family FROM color c JOIN product p ON p.id = c.product_id
           WHERE p.slug = 'leaf-gold'`;

    expect(rows[0]?.["family"]).toBe("gold");
  });

  it("finds a color by the family it lands in, without it being stored", async () => {
    await insertProduct(harness, {
      kind: "color",
      slug: "leaf-gold",
      name: "Leaf Gold",
      priceCents: 100,
      hex: "#d4a017",
    });

    const body = jsonOf(await get("/api/v1/products?family=gold"));
    const slugs = (Array.isArray(body["items"]) ? body["items"] : []).map(
      (item: Record<string, unknown>) => item["slug"],
    );

    expect(slugs).toContain("leaf-gold");
    expect(slugs).not.toContain("cathedral-moss");
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

describe("GET /products/:slug", () => {
  it("404s for a color that does not exist", async () => {
    const response = await get("/api/v1/products/no-such-color");

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });
});
