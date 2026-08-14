/**
 * API integration tests for the catalogue: search, facets, sorting, and the
 * database-derived values the application is forbidden from writing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hslToHex } from "../src/db/palette.ts";
import { jsonOf, seedCatalogue, startHarness, type Harness } from "./support/harness.ts";

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

const COLOURS = [
  { slug: "screaming-pumpkin", name: "Screaming Pumpkin", hex: "#ff8800", priceCents: 1899, finish: "gloss" },
  { slug: "municipal-beige", name: "Municipal Beige", hex: "#d8c8a8", priceCents: 899, finish: "matte" },
  { slug: "void-black", name: "Void Black", hex: "#050505", priceCents: 4999, finish: "matte" },
  { slug: "cathedral-moss", name: "Cathedral Moss", hex: "#4a7c40", priceCents: 2400, finish: "iridescent" },
];

describe("derived values", () => {
  beforeEach(async () => {
    await seedCatalogue(harness, COLOURS);
  });

  it("derives hue, saturation and lightness from the stored hex", async () => {
    const response = await get("/api/v1/products/screaming-pumpkin");
    const body = jsonOf(response);

    // #ff8800 is hsl(32, 100%, 50%). Nothing wrote these columns.
    expect(body["hue"]).toBe(32);
    expect(body["saturation"]).toBe(100);
    expect(body["lightness"]).toBe(50);
  });

  it("agrees with the TypeScript conversion in the opposite direction", async () => {
    // hslToHex composes a colour; the SQL functions take it apart again.
    // Round-tripping the two catches a drift in either.
    const response = await get("/api/v1/products/cathedral-moss");
    const body = jsonOf(response);

    const rebuilt = hslToHex(
      Number(body["hue"]),
      Number(body["saturation"]),
      Number(body["lightness"]),
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

  it("returns both unit systems from one stored set of measurements", async () => {
    const body = jsonOf(await get("/api/v1/products/void-black"));
    const measurements = body["measurements"];

    expect(measurements).toMatchObject({
      metric: {
        weightGrams: 120,
        lengthMillimetres: 30,
        widthMillimetres: 30,
        heightMillimetres: 90,
      },
      imperial: {
        weightOunces: 4.23,
        lengthInches: 1.18,
        heightInches: 3.54,
      },
    });
  });
});

describe("ratings come from the reviews table", () => {
  beforeEach(async () => {
    await seedCatalogue(harness, COLOURS);
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
    await seedCatalogue(harness, COLOURS);
  });

  it("returns everything with no filters", async () => {
    const body = jsonOf(await get("/api/v1/products"));
    expect(body["total"]).toBe(4);
  });

  it("finds a colour by a word in its name", async () => {
    const body = jsonOf(await get("/api/v1/products?q=screaming"));
    expect(body["total"]).toBe(1);
  });

  it("matches on the foundry name as well as the colour", async () => {
    const body = jsonOf(await get("/api/v1/products?q=chroma"));
    expect(body["total"]).toBe(4);
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
      INSERT INTO product (slug, name, description, price_cents, category_id, brand_id, hex, finish, weight_grams, length_mm, width_mm, height_mm)
      SELECT 'crimson', 'Crimson', 'red', 1000, c.id, b.id, '#e01020', 'matte', 120, 30, 30, 90
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
    const body = jsonOf(await get("/api/v1/products?q=nosuchcolourexists"));

    expect(body["total"]).toBe(0);
    expect(body["items"]).toEqual([]);
  });
});

describe("facets", () => {
  beforeEach(async () => {
    await seedCatalogue(harness, COLOURS);
  });

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

  it("counts finishes correctly", async () => {
    const body = jsonOf(await get("/api/v1/products"));
    const facets = body["facets"] as Record<string, unknown>;
    const finishes = facets["finishes"] as readonly Record<string, unknown>[];

    expect(finishes.find((bucket) => bucket["value"] === "matte")?.["count"]).toBe(2);
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

describe("GET /products/suggest", () => {
  beforeEach(async () => {
    await seedCatalogue(harness, COLOURS);
  });

  it("suggests on a partial word, before it is a whole word", async () => {
    const body = JSON.parse((await get("/api/v1/products/suggest?q=screa")).body);

    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toMatchObject({ kind: "product", slug: "screaming-pumpkin" });
  });

  it("carries the swatch colour for products", async () => {
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

    await sql`INSERT INTO category (slug, name) VALUES ('reds', 'Reds')`;
    await sql`
      INSERT INTO category (slug, name, parent_id)
      SELECT 'crimsons', 'Crimsons', id FROM category WHERE slug = 'reds'
    `;
    await sql`INSERT INTO brand (slug, name) VALUES ('chroma-labs', 'Chroma Labs')`;
    await sql`
      INSERT INTO product (slug, name, description, price_cents, category_id, brand_id, hex, finish, weight_grams, length_mm, width_mm, height_mm)
      SELECT 'deep-crimson', 'Deep Crimson', 'red', 1000, c.id, b.id, '#a00020', 'matte', 120, 30, 30, 90
      FROM category c, brand b WHERE c.slug = 'crimsons' AND b.slug = 'chroma-labs'
    `;

    const tree = JSON.parse((await get("/api/v1/categories")).body);

    expect(tree).toHaveLength(1);
    expect(tree[0].slug).toBe("reds");
    expect(tree[0].children[0].slug).toBe("crimsons");
    // The product sits in the child, but the parent counts it too.
    expect(tree[0].productCount).toBe(1);
    expect(tree[0].children[0].productCount).toBe(1);
  });
});

describe("GET /products/:slug", () => {
  it("404s for a colour that does not exist", async () => {
    const response = await get("/api/v1/products/no-such-colour");

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });
});
