/**
 * The search and facet SQL builders.
 *
 * These assert on the generated statement and its bound parameters, which is
 * how the injection guarantee gets checked at the unit level: whatever a
 * shopper types must appear in `params`, never in `sql`.
 */

import { Option, type ProductQuery } from "@hue/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildConditions,
  buildOrderBy,
  combineConditions,
  descendantCategoryIds,
  finishLabel,
  hueCondition,
  ratingFacetLabel,
  relevanceExpression,
  toOffset,
  toTotalPages,
  toTsQuery,
} from "./search.ts";

const dialect = new PgDialect();

/** Renders a fragment the way the driver would, without a connection. */
const render = (fragment: Parameters<typeof dialect.sqlToQuery>[0]) =>
  dialect.sqlToQuery(fragment);

const baseQuery: ProductQuery = {
  text: Option.none,
  categorySlug: Option.none,
  brandSlugs: [],
  finishes: [],
  price: Option.none,
  minRating: Option.none,
  hue: Option.none,
  saturation: Option.none,
  sort: "relevance",
  page: 1,
  perPage: 24,
};

describe("toTsQuery", () => {
  it("binds the search term rather than interpolating it", () => {
    const { sql, params } = render(toTsQuery("screaming pumpkin"));

    expect(sql).toBe("plainto_tsquery('english', $1)");
    expect(params).toEqual(["screaming pumpkin"]);
  });

  it("keeps tsquery operators out of the statement", () => {
    // plainto_tsquery treats these as words, not syntax — no parse error and
    // no operator injection.
    const { sql, params } = render(toTsQuery("red & blue | !green"));

    expect(sql).not.toContain("&");
    expect(params).toEqual(["red & blue | !green"]);
  });

  it("binds a SQL injection attempt as data", () => {
    const payload = "'; DROP TABLE product; --";
    const { sql, params } = render(toTsQuery(payload));

    expect(sql).not.toContain("DROP");
    expect(params).toEqual([payload]);
  });
});

describe("descendantCategoryIds", () => {
  it("walks the tree downwards with a recursive CTE", () => {
    const { sql, params } = render(descendantCategoryIds("reds"));

    expect(sql).toContain("WITH RECURSIVE");
    expect(sql).toContain("child.parent_id = subtree.id");
    expect(params).toEqual(["reds"]);
  });
});

describe("hueCondition", () => {
  it("uses a plain interval for an ordinary range", () => {
    const { sql, params } = render(hueCondition({ min: 90, max: 150 }));

    expect(sql).toContain("BETWEEN");
    expect(sql).not.toContain(" OR ");
    expect(params).toEqual([90, 150]);
  });

  it("uses a disjunction when the range wraps through 0", () => {
    const { sql, params } = render(hueCondition({ min: 340, max: 20 }));

    expect(sql).toContain(" OR ");
    expect(sql).not.toContain("BETWEEN");
    expect(params).toEqual([340, 20]);
  });

  it("treats a full-circle range as an interval", () => {
    expect(render(hueCondition({ min: 0, max: 360 })).sql).toContain("BETWEEN");
  });
});

describe("buildConditions", () => {
  it("produces nothing for an unfiltered query", () => {
    expect(buildConditions(baseQuery)).toHaveLength(0);
    expect(combineConditions(buildConditions(baseQuery))).toEqual(Option.none);
  });

  it("adds one condition per active filter", () => {
    const conditions = buildConditions({
      ...baseQuery,
      categorySlug: Option.some("reds"),
      brandSlugs: ["chroma-labs"],
      finishes: ["matte"],
      minRating: Option.some(4),
    });

    expect(conditions).toHaveLength(4);
  });

  it("expands a price range into two bounds", () => {
    const conditions = buildConditions({
      ...baseQuery,
      price: Option.some({ min: 1000, max: 5000 }),
    });

    expect(conditions).toHaveLength(2);
  });

  it("searches all three vectors so a foundry name matches too", () => {
    const conditions = buildConditions({
      ...baseQuery,
      text: Option.some("cyan"),
    });

    const { sql } = render(conditions[0]!);

    expect(sql).toContain("search_vector");
    expect(sql).toContain("brand_search_vector");
    expect(sql).toContain("category_search_vector");
  });

  describe("facet exclusion", () => {
    const filtered: ProductQuery = {
      ...baseQuery,
      categorySlug: Option.some("reds"),
      brandSlugs: ["chroma-labs"],
      finishes: ["matte"],
      minRating: Option.some(4),
    };

    it("omits the brand filter when counting brands", () => {
      // Otherwise ticking one brand shows every other brand with a count of
      // zero, and multi-select becomes impossible.
      const withAll = buildConditions(filtered);
      const withoutBrand = buildConditions(filtered, Option.some("brand"));

      expect(withoutBrand).toHaveLength(withAll.length - 1);
    });

    it("omits the category filter when counting categories", () => {
      expect(buildConditions(filtered, Option.some("category"))).toHaveLength(3);
    });

    it("omits both price bounds when computing price extents", () => {
      const priced = { ...filtered, price: Option.some({ min: 1, max: 2 }) };

      expect(buildConditions(priced)).toHaveLength(6);
      expect(buildConditions(priced, Option.some("price"))).toHaveLength(4);
    });

    it("keeps the search term in every facet count", () => {
      // The term narrows the result set itself; it is not a facet dimension.
      const searched = { ...filtered, text: Option.some("red") };

      for (const dimension of ["brand", "category", "finish", "rating"] as const) {
        const conditions = buildConditions(searched, Option.some(dimension));
        const rendered = conditions.map((condition) => render(condition).sql);

        expect(rendered.some((sql) => sql.includes("search_vector")), dimension).toBe(
          true,
        );
      }
    });
  });
});

describe("buildOrderBy", () => {
  it("orders by relevance when there is a search term", () => {
    const [first] = buildOrderBy("relevance", Option.some("crimson"));
    expect(render(first!).sql).toContain("ts_rank_cd");
  });

  it("falls back to newest when there is nothing to be relevant to", () => {
    const [first] = buildOrderBy("relevance", Option.none);

    const { sql } = render(first!);
    expect(sql).not.toContain("ts_rank_cd");
    expect(sql).toContain("created_at");
  });

  it("orders by price in both directions", () => {
    expect(render(buildOrderBy("price_asc", Option.none)[0]!).sql).toMatch(
      /price_cents.* asc/i,
    );
    expect(render(buildOrderBy("price_desc", Option.none)[0]!).sql).toMatch(
      /price_cents.* desc/i,
    );
  });

  it("breaks a rating tie with the number of reviews", () => {
    const clauses = buildOrderBy("rating", Option.none).map(
      (clause) => render(clause).sql,
    );

    expect(clauses[0]).toContain("rating_average");
    expect(clauses[1]).toContain("rating_count");
  });

  it("always ends on a unique column, so paging is stable", () => {
    for (const sort of ["relevance", "price_asc", "price_desc", "rating"] as const) {
      const clauses = buildOrderBy(sort, Option.none);
      const last = render(clauses[clauses.length - 1]!).sql;

      expect(last, sort).toContain("slug");
    }
  });
});

describe("relevanceExpression", () => {
  it("weights the colour's own name above its foundry and category", () => {
    const { sql, params } = render(relevanceExpression("crimson"));

    expect(sql).toContain("* 4");
    expect(sql).toContain("* 2");
    // The term is bound once per vector, never spliced into the statement.
    expect(params).toEqual(["crimson", "crimson", "crimson"]);
  });
});

describe("pagination arithmetic", () => {
  it("converts 1-based pages to 0-based offsets", () => {
    expect(toOffset(1, 24)).toBe(0);
    expect(toOffset(2, 24)).toBe(24);
    expect(toOffset(5, 10)).toBe(40);
  });

  it("rounds page counts up", () => {
    expect(toTotalPages(0, 24)).toBe(0);
    expect(toTotalPages(1, 24)).toBe(1);
    expect(toTotalPages(24, 24)).toBe(1);
    expect(toTotalPages(25, 24)).toBe(2);
    expect(toTotalPages(240, 24)).toBe(10);
  });
});

describe("facet labels", () => {
  it("says 1 star and 4 stars correctly", () => {
    expect(ratingFacetLabel(1)).toBe("1 star & up");
    expect(ratingFacetLabel(4)).toBe("4 stars & up");
  });

  it("capitalises finishes for display", () => {
    expect(finishLabel("matte")).toBe("Matte");
    expect(finishLabel("fluorescent")).toBe("Fluorescent");
  });
});
