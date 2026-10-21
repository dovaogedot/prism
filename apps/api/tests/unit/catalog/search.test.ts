/**
 * The search SQL is checked as text plus bindings: a value a shopper typed
 * has to show up as a parameter, never inside the statement.
 */

import { Slug, type ProductQuery } from "@prism/shared";
import { and, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ProductSearch, type RatingColumns } from "../../../src/modules/catalog/search.ts";

const dialect = new PgDialect();

const slug = (value: string): Slug => Slug.schema.parse(value);

/** The statement and its parameters, the way the driver would receive them. */
const render = (fragment: SQL) => dialect.sqlToQuery(fragment);

const rating: RatingColumns = { average: sql`rating.average`, count: sql`rating.count` };

const query = (overrides: Partial<ProductQuery> = {}): ProductQuery => ({
  brands: [],
  properties: [],
  sort: "relevance",
  page: 1,
  perPage: 12,
  ...overrides,
});

const PAYLOAD = "'; DROP TABLE product; --";

describe("ProductSearch.likePattern", () => {
  it("escapes the LIKE metacharacters and wraps in wildcards", () => {
    expect(ProductSearch.likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  it("anchors a prefix at the start only", () => {
    expect(ProductSearch.prefixPattern("de")).toBe("de%");
  });
});

describe("ProductSearch.ratingLabel", () => {
  it("names the top threshold without an 'up'", () => {
    expect(ProductSearch.ratingLabel(5)).toBe("5 stars");
    expect(ProductSearch.ratingLabel(3)).toBe("3 stars & up");
  });
});

describe("ProductSearch.conditions", () => {
  it("is empty for a query with no filters", () => {
    expect(ProductSearch.conditions(query(), rating)).toEqual([]);
    expect(ProductSearch.where([])).toBeUndefined();
  });

  it("binds the search text rather than inlining it", () => {
    const [condition] = ProductSearch.conditions(query({ text: PAYLOAD }), rating);
    if (condition === undefined) throw new Error("expected a text condition");

    const rendered = render(condition);

    expect(rendered.sql).not.toContain("DROP");
    expect(rendered.params).toEqual([PAYLOAD, `%${PAYLOAD}%`]);
  });

  it("binds every property name and value", () => {
    const conditions = ProductSearch.conditions(
      query({ properties: [{ name: PAYLOAD, values: ["red", PAYLOAD] }] }),
      rating,
    );
    const rendered = render(and(...conditions) ?? sql``);

    expect(rendered.sql).not.toContain("DROP");
    expect(rendered.params).toEqual([PAYLOAD, "red", PAYLOAD]);
    expect(rendered.sql).toContain("owned.value in ($2, $3)");
  });

  it("binds the category, brands, price bounds and rating", () => {
    const conditions = ProductSearch.conditions(
      query({
        category: slug("lamps"),
        brands: [slug("acme"), slug("globex")],
        priceMinCents: 100,
        priceMaxCents: 5000,
        minRating: 4,
      }),
      rating,
    );

    expect(render(and(...conditions) ?? sql``).params).toEqual(["lamps", "acme", "globex", 100, 5000, 4]);
  });

  it("leaves out the filter of the lifted facet", () => {
    const full = query({ category: slug("lamps"), brands: [slug("acme")], priceMinCents: 1, minRating: 2 });

    expect(render(and(...ProductSearch.conditions(full, rating, "brand")) ?? sql``).params).toEqual(["lamps", 1, 2]);
    expect(render(and(...ProductSearch.conditions(full, rating, "price")) ?? sql``).params).toEqual(["lamps", "acme", 2]);
    expect(render(and(...ProductSearch.conditions(full, rating, "rating")) ?? sql``).params).toEqual(["lamps", "acme", 1]);
  });

  it("lets a property's own rows through when properties are lifted", () => {
    const [condition] = ProductSearch.conditions(
      query({ properties: [{ name: "color", values: ["red"] }] }),
      rating,
      "property",
    );
    if (condition === undefined) throw new Error("expected a property condition");

    const rendered = render(condition);

    expect(rendered.sql).toMatch(/^\("product_property"\."name" = \$1 or EXISTS/);
    expect(rendered.params).toEqual(["color", "color", "red"]);
  });
});

describe("ProductSearch.shelf and narrowing", () => {
  it("puts the text and category on the shelf and the rest in the narrowing", () => {
    const full = query({ text: "lamp", category: slug("lamps"), brands: [slug("acme")], minRating: 3 });

    expect(render(and(...ProductSearch.shelf(full)) ?? sql``).params).toEqual(["lamp", "%lamp%", "lamps"]);
    expect(render(and(...ProductSearch.narrowing(full, rating)) ?? sql``).params).toEqual(["acme", 3]);
  });

  it("renders no conditions as a true filter", () => {
    expect(render(ProductSearch.filter([])).sql).toBe("true");
    expect(render(ProductSearch.filter(ProductSearch.narrowing(query({ brands: [slug("acme")] }), rating))).params).toEqual(["acme"]);
  });
});

describe("ProductSearch.orderBy", () => {
  it("ends every order in the slug so pages are stable", () => {
    for (const sort of ["relevance", "price_asc", "price_desc", "rating", "newest"] as const) {
      const order = ProductSearch.orderBy(query({ sort, text: "lamp" }), rating);
      const last = order[order.length - 1];
      if (last === undefined) throw new Error("expected an order");

      expect(render(last).sql, sort).toContain('"product"."slug" asc');
    }
  });

  it("puts an exact name first for relevance, then ranks by the bound search text", () => {
    const [exact, rank] = ProductSearch.orderBy(query({ text: PAYLOAD }), rating);
    if (exact === undefined || rank === undefined) throw new Error("expected an order");

    expect(render(exact).sql).toContain("lower(");
    expect(render(exact).params).toEqual([PAYLOAD]);
    expect(render(rank).sql).toContain("ts_rank");
    expect(render(rank).params).toEqual([PAYLOAD]);
  });

  it("ranks by how alike the names are once the search fell back to similar names", () => {
    const [first] = ProductSearch.orderBy(query({ text: PAYLOAD }), rating, "similar");
    if (first === undefined) throw new Error("expected an order");

    const rendered = render(first);

    expect(rendered.sql).toContain("similarity(");
    expect(rendered.params).toEqual([PAYLOAD]);
  });

  it("sorts by name when there is no text to rank against", () => {
    const [first] = ProductSearch.orderBy(query(), rating);
    if (first === undefined) throw new Error("expected an order");

    expect(render(first).sql).toBe('"product"."name" asc');
  });
});

describe("ProductSearch paging", () => {
  it("offsets from page one", () => {
    expect(ProductSearch.offset(query({ page: 1, perPage: 12 }))).toBe(0);
    expect(ProductSearch.offset(query({ page: 3, perPage: 12 }))).toBe(24);
  });

  it("never reports fewer than one page", () => {
    expect(ProductSearch.totalPages(0, 12)).toBe(1);
    expect(ProductSearch.totalPages(12, 12)).toBe(1);
    expect(ProductSearch.totalPages(13, 12)).toBe(2);
  });
});
