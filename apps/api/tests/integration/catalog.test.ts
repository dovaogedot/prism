/**
 * The catalog endpoints over a real Postgres: search, facets, property
 * filters, sorting, suggestions and the product page.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.stop();
});

const get = (url: string) => harness.app.inject({ method: "GET", url });

/** A small shop with two categories, two brands and two named properties. */
const seedShop = () =>
  seedCatalog(harness, [
    {
      slug: "desk-lamp",
      name: "Desk Lamp",
      description: "A lamp for a desk",
      priceCents: 2500,
      category: "Lighting",
      brand: "Acme",
      properties: { color: "red", material: "steel" },
      images: ["desk-lamp-1.svg"],
      ratings: [5, 4],
    },
    {
      slug: "floor-lamp",
      name: "Floor Lamp",
      description: "Stands on the floor",
      priceCents: 8000,
      category: "Lighting",
      brand: "Globex",
      properties: { color: "black", material: "steel" },
      ratings: [3],
    },
    {
      slug: "oak-chair",
      name: "Oak Chair",
      description: "A chair made of oak",
      priceCents: 12000,
      stock: 0,
      category: "Furniture",
      brand: "Acme",
      properties: { color: "red", material: "wood" },
    },
  ]);

beforeEach(async () => {
  await harness.reset();
  await seedShop();
});

describe("GET /api/v1/products", () => {
  it("lists everything by name with the facets of the whole shop", async () => {
    const body = jsonOf(await get("/api/v1/products"));
    const items = body["items"] as { slug: string; rating: { average: number; count: number } }[];

    expect(body["total"]).toBe(3);
    expect(items.map((item) => item.slug)).toEqual(["desk-lamp", "floor-lamp", "oak-chair"]);
    expect(items[0]?.rating).toEqual({ average: 4.5, count: 2 });

    const facets = body["facets"] as Record<string, unknown>;

    expect(Object.keys(facets).toSorted()).toEqual(["brands", "price", "properties", "ratings"]);
    expect(facets["brands"]).toEqual([
      { value: "acme", label: "Acme", count: 2 },
      { value: "globex", label: "Globex", count: 1 },
    ]);
    expect(facets["price"]).toEqual({ minCents: 2500, maxCents: 12000 });
    expect(facets["properties"]).toEqual([
      {
        name: "color",
        buckets: [
          { value: "black", label: "black", count: 1 },
          { value: "red", label: "red", count: 2 },
        ],
      },
      {
        name: "material",
        buckets: [
          { value: "steel", label: "steel", count: 2 },
          { value: "wood", label: "wood", count: 1 },
        ],
      },
    ]);
  });

  it("counts rating thresholds cumulatively, highest first", async () => {
    const facets = jsonOf(await get("/api/v1/products"))["facets"] as { ratings: unknown };

    expect(facets.ratings).toEqual([
      { value: "5", label: "5 stars", count: 0 },
      { value: "4", label: "4 stars & up", count: 1 },
      { value: "3", label: "3 stars & up", count: 2 },
      { value: "2", label: "2 stars & up", count: 2 },
      { value: "1", label: "1 stars & up", count: 2 },
    ]);
  });

  it("matches words in the description through full-text search", async () => {
    const body = jsonOf(await get("/api/v1/products?q=floor"));
    expect((body["items"] as { slug: string }[]).map((item) => item.slug)).toEqual(["floor-lamp"]);
  });

  it("matches a fragment of the name", async () => {
    const body = jsonOf(await get("/api/v1/products?q=lam"));
    expect(body["total"]).toBe(2);
  });

  it("filters by category and brand slugs", async () => {
    expect(jsonOf(await get("/api/v1/products?category=lighting"))["total"]).toBe(2);
    expect(jsonOf(await get("/api/v1/products?brand=globex"))["total"]).toBe(1);
    expect(jsonOf(await get("/api/v1/products?brand=globex&brand=acme"))["total"]).toBe(3);
    expect(jsonOf(await get("/api/v1/products?category=furniture&brand=globex"))["total"]).toBe(0);
  });

  it("filters by a price range in cents", async () => {
    const body = jsonOf(await get("/api/v1/products?priceMin=3000&priceMax=10000"));
    expect((body["items"] as { slug: string }[]).map((item) => item.slug)).toEqual(["floor-lamp"]);
  });

  it("filters by a minimum rating", async () => {
    expect(jsonOf(await get("/api/v1/products?rating=4"))["total"]).toBe(1);
    expect(jsonOf(await get("/api/v1/products?rating=1"))["total"]).toBe(2);
  });

  it("filters and counts a rating as its card shows it, rounded to one decimal", async () => {
    await harness.database.sql`UPDATE product SET rating_average = 3.96, rating_count = 25 WHERE slug = 'oak-chair'`;

    const atLeastFour = jsonOf(await get("/api/v1/products?rating=4"));
    const facets = jsonOf(await get("/api/v1/products"))["facets"] as { ratings: { value: string; count: number }[] };
    const chair = (atLeastFour["items"] as { slug: string; rating: { average: number } }[]).find((item) => item.slug === "oak-chair");

    expect(chair?.rating.average).toBe(4);
    expect(facets.ratings.find((bucket) => bucket.value === "4")?.count).toBe(atLeastFour["total"]);
  });

  it("filters by any named property, with values within one name as alternatives", async () => {
    expect(jsonOf(await get("/api/v1/products?p.color=red"))["total"]).toBe(2);
    expect(jsonOf(await get("/api/v1/products?p.color=red&p.color=black"))["total"]).toBe(3);
    expect(jsonOf(await get("/api/v1/products?p.color=red&p.material=wood"))["total"]).toBe(1);
    expect(jsonOf(await get("/api/v1/products?p.nonsense=x"))["total"]).toBe(0);
  });

  it("refuses a filter holding the NUL character, which Postgres cannot compare", async () => {
    expect((await get("/api/v1/products?p.color=%00")).statusCode).toBe(422);
    expect((await get("/api/v1/products?p.%00=red")).statusCode).toBe(422);
  });

  it("refuses a price filter past what the price column holds, rather than failing in Postgres", async () => {
    expect((await get("/api/v1/products?priceMax=2147483648")).statusCode).toBe(422);
  });

  it("counts the whole match on a page past the end, and keeps a text search exact there", async () => {
    const past = jsonOf(await get("/api/v1/products?perPage=1&page=10"));
    const search = jsonOf(await get("/api/v1/products?q=lamp&perPage=1&page=10"));

    expect(past).toMatchObject({ items: [], total: 3, totalPages: 3, page: 10 });
    expect(search).toMatchObject({ items: [], matched: "exact", total: 2, totalPages: 2 });
  });

  it("keeps a listing's facets for at most 5 seconds, whatever page or sort is asked for", async () => {
    const facetsOf = async (url: string) => jsonOf(await get(url))["facets"] as { price: { maxCents: number } };

    const first = await facetsOf("/api/v1/products?category=lighting");
    await harness.database.sql`UPDATE product SET price_cents = 99900 WHERE slug = 'desk-lamp'`;
    const otherPage = await facetsOf("/api/v1/products?category=lighting&page=2&sort=price_desc");
    harness.clock.advanceSeconds(5);
    const later = await facetsOf("/api/v1/products?category=lighting&page=2");

    expect(otherPage).toEqual(first);
    expect(later.price.maxCents).toBe(99900);
  });

  it("keeps a facet's siblings countable while one of its values is chosen", async () => {
    const facets = jsonOf(await get("/api/v1/products?category=lighting&p.color=red"))["facets"] as {
      brands: { value: string; count: number }[];
      properties: { name: string; buckets: { value: string; count: number }[] }[];
    };

    // Color counts ignore the color filter but keep the category filter.
    expect(facets.properties.find((facet) => facet.name === "color")?.buckets).toEqual([
      { value: "black", label: "black", count: 1 },
      { value: "red", label: "red", count: 1 },
    ]);
    // Material counts keep both filters.
    expect(facets.properties.find((facet) => facet.name === "material")?.buckets).toEqual([
      { value: "steel", label: "steel", count: 1 },
    ]);
    // Brands are listed over the shelf; the one the color filter excludes stays at zero.
    expect(facets.brands).toEqual([
      { value: "acme", label: "Acme", count: 1 },
      { value: "globex", label: "Globex", count: 0 },
    ]);
  });

  it("keeps a value listed at zero when a filter of the rail excludes it", async () => {
    const facets = jsonOf(await get("/api/v1/products?brand=globex"))["facets"] as {
      properties: { name: string; buckets: { value: string; count: number }[] }[];
      price: { minCents: number; maxCents: number };
    };

    expect(facets.properties.find((facet) => facet.name === "color")?.buckets).toEqual([
      { value: "black", label: "black", count: 1 },
      { value: "red", label: "red", count: 0 },
    ]);
    // The slider's bounds come from the shelf, not from the brand chosen.
    expect(facets.price).toEqual({ minCents: 2500, maxCents: 12000 });
  });

  it("lists only the shelf's values once a category is chosen", async () => {
    const facets = jsonOf(await get("/api/v1/products?category=furniture"))["facets"] as {
      brands: { value: string }[];
      properties: { name: string; buckets: { value: string }[] }[];
    };

    expect(facets.brands.map((bucket) => bucket.value)).toEqual(["acme"]);
    expect(facets.properties.find((facet) => facet.name === "material")?.buckets.map((b) => b.value)).toEqual(["wood"]);
  });

  it("sorts by price either way and by rating", async () => {
    const slugsFor = async (sort: string) =>
      (jsonOf(await get(`/api/v1/products?sort=${sort}`))["items"] as { slug: string }[]).map((item) => item.slug);

    expect(await slugsFor("price_asc")).toEqual(["desk-lamp", "floor-lamp", "oak-chair"]);
    expect(await slugsFor("price_desc")).toEqual(["oak-chair", "floor-lamp", "desk-lamp"]);
    expect(await slugsFor("rating")).toEqual(["desk-lamp", "floor-lamp", "oak-chair"]);
  });

  it("pages with a stable order", async () => {
    const first = jsonOf(await get("/api/v1/products?perPage=2&page=1"));
    const second = jsonOf(await get("/api/v1/products?perPage=2&page=2"));

    expect(first["totalPages"]).toBe(2);
    expect((first["items"] as unknown[]).length).toBe(2);
    expect((second["items"] as { slug: string }[]).map((item) => item.slug)).toEqual(["oak-chair"]);
  });

  it("serves the image URLs under /media, with no smaller copies before housekeeping makes them", async () => {
    const [item] = jsonOf(await get("/api/v1/products?q=desk"))["items"] as { images: { url: string; alt: string }[] }[];
    expect(item?.images).toEqual([
      { id: expect.any(String), url: "/media/desk-lamp-1.svg", alt: "Desk Lamp", isPixelArt: false, sources: [] },
    ]);
  });

  it("rejects a malformed query", async () => {
    expect((await get("/api/v1/products?sort=sideways")).statusCode).toBe(422);
    expect((await get("/api/v1/products?rating=9")).statusCode).toBe(422);
    expect((await get("/api/v1/products?category=Not%20A%20Slug")).statusCode).toBe(422);
  });

  it("takes at most 20 property filters", async () => {
    const filters = (count: number) => Array.from({ length: count }, (_, index) => `p.name${index}=x`).join("&");

    expect((await get(`/api/v1/products?${filters(20)}`)).statusCode).toBe(200);
    expect((await get(`/api/v1/products?${filters(21)}`)).statusCode).toBe(422);
  });

  it("runs every statement under a time limit", async () => {
    const [setting] = await harness.database.sql`SHOW statement_timeout`;

    expect(setting?.["statement_timeout"]).toBe("30s");
  });
});

describe("GET /api/v1/products/suggest", () => {
  it("offers names starting with the text before names containing it", async () => {
    const slugsOf = (body: Record<string, unknown>) => (body["items"] as { slug: string }[]).map((item) => item.slug);

    expect(slugsOf(jsonOf(await get("/api/v1/products/suggest?q=la")))).toEqual(["desk-lamp", "floor-lamp"]);
    expect(slugsOf(jsonOf(await get("/api/v1/products/suggest?q=fl")))).toEqual(["floor-lamp"]);
  });

  it("caps the list at the requested limit", async () => {
    const body = jsonOf(await get("/api/v1/products/suggest?q=a&limit=1"));
    expect((body["items"] as unknown[]).length).toBe(1);
  });

  it("requires some text", async () => {
    expect((await get("/api/v1/products/suggest?q=")).statusCode).toBe(422);
  });
});

describe("GET /api/v1/products/:slug", () => {
  it("returns the whole product with both unit systems", async () => {
    const body = jsonOf(await get("/api/v1/products/desk-lamp"));

    expect(body).toMatchObject({
      slug: "desk-lamp",
      name: "Desk Lamp",
      description: "A lamp for a desk",
      priceCents: 2500,
      stock: 10,
      category: { slug: "lighting", name: "Lighting" },
      brand: { slug: "acme", name: "Acme" },
      rating: { average: 4.5, count: 2 },
      properties: [
        { name: "color", value: "red" },
        { name: "material", value: "steel" },
      ],
      weight: { grams: 1000, ounces: 35.27 },
      dimensions: {
        millimeters: { width: 254, height: 127, depth: 25 },
        inches: { width: 10, height: 5, depth: 0.98 },
      },
    });
  });

  it("says when another product of the category has the same name", async () => {
    await seedCatalog(harness, [{ slug: "desk-lamp-2", name: "desk lamp", priceCents: 900, category: "Lighting" }]);

    expect(jsonOf(await get("/api/v1/products/desk-lamp"))["isNameShared"]).toBe(true);
    expect(jsonOf(await get("/api/v1/products/floor-lamp"))["isNameShared"]).toBe(false);
  });

  it("answers 404 for a slug nothing carries", async () => {
    const response = await get("/api/v1/products/nothing-here");

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });
});
