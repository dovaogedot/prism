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

    expect(facets["categories"]).toEqual([
      { value: "furniture", label: "Furniture", count: 1 },
      { value: "lighting", label: "Lighting", count: 2 },
    ]);
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

  it("filters by any named property, with values within one name as alternatives", async () => {
    expect(jsonOf(await get("/api/v1/products?p.color=red"))["total"]).toBe(2);
    expect(jsonOf(await get("/api/v1/products?p.color=red&p.color=black"))["total"]).toBe(3);
    expect(jsonOf(await get("/api/v1/products?p.color=red&p.material=wood"))["total"]).toBe(1);
    expect(jsonOf(await get("/api/v1/products?p.nonsense=x"))["total"]).toBe(0);
  });

  it("keeps a facet's siblings countable while one of its values is chosen", async () => {
    const facets = jsonOf(await get("/api/v1/products?category=lighting&p.color=red"))["facets"] as {
      categories: { value: string; count: number }[];
      brands: { value: string; count: number }[];
      properties: { name: string; buckets: { value: string; count: number }[] }[];
    };

    // Category counts ignore the category filter but keep the color filter.
    expect(facets.categories).toEqual([
      { value: "furniture", label: "Furniture", count: 1 },
      { value: "lighting", label: "Lighting", count: 1 },
    ]);
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
      categories: { value: string; count: number }[];
      properties: { name: string; buckets: { value: string; count: number }[] }[];
      price: { minCents: number; maxCents: number };
    };

    expect(facets.categories).toEqual([
      { value: "furniture", label: "Furniture", count: 0 },
      { value: "lighting", label: "Lighting", count: 1 },
    ]);
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

  it("serves the image URLs under /media", async () => {
    const [item] = jsonOf(await get("/api/v1/products?q=desk"))["items"] as { images: { url: string; alt: string }[] }[];
    expect(item?.images).toEqual([{ url: "/media/desk-lamp-1.svg", alt: "Desk Lamp" }]);
  });

  it("rejects a malformed query", async () => {
    expect((await get("/api/v1/products?sort=sideways")).statusCode).toBe(422);
    expect((await get("/api/v1/products?rating=9")).statusCode).toBe(422);
    expect((await get("/api/v1/products?category=Not%20A%20Slug")).statusCode).toBe(422);
  });
});

describe("GET /api/v1/products/suggest", () => {
  it("offers names starting with the text before names containing it", async () => {
    const body = jsonOf(await get("/api/v1/products/suggest?q=la"));
    expect(body["items"]).toEqual([
      { slug: "desk-lamp", name: "Desk Lamp" },
      { slug: "floor-lamp", name: "Floor Lamp" },
    ]);

    const prefixed = jsonOf(await get("/api/v1/products/suggest?q=fl"));
    expect(prefixed["items"]).toEqual([{ slug: "floor-lamp", name: "Floor Lamp" }]);
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

  it("answers 404 for a slug nothing carries", async () => {
    const response = await get("/api/v1/products/nothing-here");

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });
});
