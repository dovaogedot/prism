/**
 * Product search as a shopper relies on it, over a real Postgres: what a
 * query finds and in what order, whether the counts the filters show add up
 * to the results they lead to, and whether each query is one the indexes
 * answer. The last is read from the query plan, not from timings.
 */

import { ilike } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { products } from "../../src/db/schema.ts";
import { ProductSearch } from "../../src/modules/catalog/search.ts";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

/** One page of results as the tests read it. */
type Results = Readonly<{
  items: readonly Readonly<{ slug: string; name: string; priceCents: number; rating: Readonly<{ average: number; count: number }> }>[];
  total: number;
  totalPages: number;
  matched: string;
  facets: Readonly<{
    categories: readonly Readonly<{ value: string; count: number }>[];
    brands: readonly Readonly<{ value: string; count: number }>[];
    ratings: readonly Readonly<{ value: string; count: number }>[];
    properties: readonly Readonly<{ name: string; buckets: readonly Readonly<{ value: string; count: number }>[] }>[];
  }>;
}>;

/** The largest page the API serves; the catalog below fits in one. */
const WHOLE_PAGE = 60;

const search = async (query: string): Promise<Results> =>
  jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1/products?${query}` })) as unknown as Results;

/** Every result of `query`, all pages at once. */
const everything = async (query: string): Promise<readonly string[]> =>
  (await search(`${query}${query.length === 0 ? "" : "&"}perPage=${WHOLE_PAGE}`)).items.map((item) => item.slug);

beforeAll(async () => {
  harness = await startHarness();
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "lamp", name: "Lamp", description: "Just a lamp.", priceCents: 1900, category: "Lighting", brand: "Acme", properties: { color: "white" } },
    { slug: "desk-lamp", name: "Desk Lamp", description: "A brass lamp for a desk.", priceCents: 2500, category: "Lighting", brand: "Acme", properties: { color: "brass" }, ratings: [5, 4] },
    { slug: "floor-lamp", name: "Floor Lamp", description: "Tall and bright.", priceCents: 8000, category: "Lighting", brand: "Globex", properties: { color: "black" }, ratings: [3] },
    { slug: "lamp-shade", name: "Lamp Shade", description: "Linen, for any lamp.", priceCents: 1500, category: "Lighting", brand: "Acme", properties: { color: "white" } },
    { slug: "desk-chair", name: "Desk Chair", description: "Sits at a desk.", priceCents: 12_000, category: "Furniture", brand: "Initech", properties: { color: "black" }, ratings: [4, 4, 5] },
    { slug: "oak-desk", name: "Oak Desk", description: "Solid oak.", priceCents: 30_000, category: "Furniture", brand: "Acme", properties: { color: "brown" } },
    { slug: "brass-candle", name: "Candle Holder", description: "Polished brass, holds one candle.", priceCents: 900, category: "Lighting", brand: "Globex", properties: { color: "brass" }, ratings: [2] },
    { slug: "diamond-sword", name: "Diamond Sword", description: "The strongest sword.", priceCents: 1600, category: "Weapons", brand: "Mojang", properties: { color: "cyan" }, ratings: [5, 5, 5] },
    { slug: "iron-sword", name: "Iron Sword", description: "A dependable sword.", priceCents: 1400, category: "Weapons", brand: "Mojang", properties: { color: "gray" } },
    { slug: "stone-sword", name: "Stone Sword", description: "A heavy sword.", priceCents: 400, category: "Weapons", brand: "Mojang", properties: { color: "gray" }, ratings: [4] },
    { slug: "diamond-pickaxe", name: "Diamond Pickaxe", description: "Mines anything.", priceCents: 3000, category: "Tools", brand: "Mojang", properties: { color: "cyan" } },
    { slug: "golden-apple", name: "Golden Apple", description: "Heals.", priceCents: 800, category: "Food", brand: "Mojang", properties: { color: "gold" }, ratings: [5, 3] },
  ]);
  // Distinct creation times, the newest last on the list above.
  await harness.database.sql`
    UPDATE product SET created_at = now() - make_interval(hours => (SELECT count(*) FROM product AS later WHERE later.slug > product.slug)::int)`;
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("accuracy", () => {
  it("puts a product named exactly what was typed first", async () => {
    const lamps = await search("q=lamp");

    expect(lamps.items[0]?.slug).toBe("lamp");
    expect(lamps.items.map((item) => item.slug)).toEqual(expect.arrayContaining(["desk-lamp", "floor-lamp", "lamp-shade"]));
  });

  it("matches a prefix, a fragment inside a name, and a word of the description", async () => {
    expect(await everything("q=pick")).toEqual(["diamond-pickaxe"]);
    expect(await everything("q=ickax")).toEqual(["diamond-pickaxe"]);
    expect(await everything("q=brass")).toEqual(expect.arrayContaining(["desk-lamp", "brass-candle"]));
    expect(await everything("q=brass")).toHaveLength(2);
  });

  it("falls back to similar names for a misspelling, and says so; an exact match never does", async () => {
    const typo = await search("q=diamnd%20sword");
    const exact = await search("q=sword");

    expect(typo.matched).toBe("similar");
    expect(typo.items[0]?.slug).toBe("diamond-sword");
    expect(exact.matched).toBe("exact");
  });
});

describe("consistency", () => {
  it("counts each facet value as exactly the products its filter then lists", async () => {
    for (const base of ["", "category=lighting"]) {
      const { facets } = await search(base);
      const prefix = base.length === 0 ? "" : `${base}&`;

      for (const bucket of facets.brands) expect((await search(`${prefix}brand=${bucket.value}`)).total, `${base} brand ${bucket.value}`).toBe(bucket.count);
      for (const bucket of facets.ratings) expect((await search(`${prefix}rating=${bucket.value}`)).total, `${base} rating ${bucket.value}`).toBe(bucket.count);
      for (const facet of facets.properties) {
        for (const bucket of facet.buckets) {
          expect((await search(`${prefix}p.${facet.name}=${bucket.value}`)).total, `${base} ${facet.name} ${bucket.value}`).toBe(bucket.count);
        }
      }
    }

    for (const bucket of (await search("")).facets.categories) expect((await search(`category=${bucket.value}`)).total).toBe(bucket.count);
  });

  it("covers every result exactly once across the pages, in every sort", async () => {
    for (const sort of ["relevance", "price_asc", "price_desc", "rating", "newest"]) {
      const first = await search(`sort=${sort}&perPage=5`);
      const paged: string[] = [];

      for (let page = 1; page <= first.totalPages; page += 1) paged.push(...(await search(`sort=${sort}&perPage=5&page=${page}`)).items.map((item) => item.slug));

      expect(paged, sort).toHaveLength(first.total);
      expect(new Set(paged).size, sort).toBe(first.total);
    }
  });

  it("suggests only products the same search would list", async () => {
    for (const text of ["la", "sword", "dia", "o"]) {
      const suggested = (jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1/products/suggest?q=${text}&limit=20` }))["items"] as { slug: string }[]).map((item) => item.slug);
      const listed = await everything(`q=${text}`);

      expect(suggested.length, text).toBeGreaterThan(0);
      expect(listed, text).toEqual(expect.arrayContaining(suggested));
    }
  });

  it("orders by every sort it offers", async () => {
    const byPrice = (await search(`sort=price_asc&perPage=${WHOLE_PAGE}`)).items.map((item) => item.priceCents);
    const byPriceDown = (await search(`sort=price_desc&perPage=${WHOLE_PAGE}`)).items.map((item) => item.priceCents);
    const byRating = (await search(`sort=rating&perPage=${WHOLE_PAGE}`)).items.map((item) => item.rating.average);
    const byName = (await search(`sort=relevance&perPage=${WHOLE_PAGE}`)).items.map((item) => item.name);
    const byNewest = await everything("sort=newest");
    const newestFirst = (await harness.database.sql`SELECT slug FROM product ORDER BY created_at DESC, slug`).map((row) => String(row["slug"]));

    expect(byPrice).toEqual([...byPrice].toSorted((a, b) => a - b));
    expect(byPriceDown).toEqual([...byPriceDown].toSorted((a, b) => b - a));
    expect(byRating).toEqual([...byRating].toSorted((a, b) => b - a));
    expect(byNewest).toEqual(newestFirst);
    expect(byName).toEqual([...byName].toSorted((a, b) => a.localeCompare(b)));
  });
});

describe("efficiency", () => {
  /** The plan Postgres makes for `query` with sequential scans priced out, so it uses an index wherever one can answer. */
  const planOf = async (query: Readonly<{ sql: string; params: unknown[] }>): Promise<string> =>
    harness.database.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      const [row] = await tx.unsafe(`EXPLAIN (FORMAT JSON) ${query.sql}`, query.params as never[]);
      return JSON.stringify(row?.["QUERY PLAN"]);
    });

  const select = () => harness.database.db.select({ id: products.id }).from(products);

  it("answers a text search from the full-text and trigram indexes, with no sequential scan of the products", async () => {
    const plan = await planOf(select().where(ProductSearch.textCondition("lamp")).toSQL());

    expect(plan).not.toMatch(/"Seq Scan"[^}]*"Relation Name":"product"/);
    expect(plan).toContain("product_search_idx");
    expect(plan).toContain("product_name_trgm_idx");
  });

  it("answers the similar-name fallback and the suggestions from the trigram index", async () => {
    const similar = await planOf(select().where(ProductSearch.textCondition("diamnd sword", "similar")).toSQL());
    const suggestions = await planOf(select().where(ilike(products.name, ProductSearch.likePattern("swor"))).toSQL());

    for (const plan of [similar, suggestions]) {
      expect(plan).not.toMatch(/"Seq Scan"[^}]*"Relation Name":"product"/);
      expect(plan).toContain("product_name_trgm_idx");
    }
  });
});
