/**
 * The search and facet SQL builders.
 *
 * These assert on the generated statement and its bound parameters, which is
 * how the injection guarantee gets checked at the unit level: whatever a
 * shopper types must appear in `params`, never in `sql`.
 */

import { Option, type ProductQuery } from "@prism/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildConditions,
  buildOrderBy,
  combineConditions,
  categorySubtreeMatching,
  descendantCategoryIds,
  finishLabel,
  hueCondition,
  nameContains,
  ratingFacetLabel,
  relevanceExpression,
  toLikePattern,
  toOffset,
  toPrefixPattern,
  toTotalPages,
  toTsQuery,
} from "../../../src/modules/catalog/search.ts";

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
  lightness: Option.none,
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

describe("categorySubtreeMatching", () => {
  it("matches a category by name and then walks down from it", () => {
    const { sql, params } = render(categorySubtreeMatching("yellows"));

    expect(sql).toContain("WITH RECURSIVE");
    expect(sql).toContain("search_vector @@");
    expect(sql).toContain("child.parent_id = matched.id");
    expect(params).toEqual(["yellows"]);
  });

  it("binds the term rather than concatenating it", () => {
    const payload = "'; DROP TABLE category; --";
    const { sql, params } = render(categorySubtreeMatching(payload));

    expect(sql).not.toContain("DROP");
    expect(params).toEqual([payload]);
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

  it("searches the color, its foundry and its category tree alike", () => {
    const conditions = buildConditions({
      ...baseQuery,
      text: Option.some("cyan"),
    });

    const { sql } = render(conditions[0]!);

    expect(sql).toContain("search_vector");
    expect(sql).toContain("brand_search_vector");
    // The category half goes through the subtree walk rather than the view's
    // own vector, so that a parent category name finds its children.
    expect(sql).toContain("child.parent_id = matched.id");
    expect(sql).toContain("ILIKE");
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
  it("weights the color's own name above its foundry and category", () => {
    const { sql } = render(relevanceExpression("crimson"));

    expect(sql).toContain("* 4");
    expect(sql).toContain("* 2");
  });

  it("ranks a literal name hit above any full-text match", () => {
    const { sql } = render(relevanceExpression("crimson"));

    // ts_rank_cd lands in the 0.0–0.2 range, so the 2 and 1 constants put a
    // name-prefix hit first and a name-substring hit second.
    expect(sql).toContain("THEN 2 ELSE 0");
    expect(sql).toContain("THEN 1 ELSE 0");
  });

  it("binds every form of the term, splicing none of them", () => {
    const { sql, params } = render(relevanceExpression("crimson"));

    expect(sql).not.toContain("crimson");
    expect(params).toEqual([
      "crimson%",
      "%crimson%",
      "crimson",
      "crimson",
      "crimson",
    ]);
  });
});

describe("substring search", () => {
  it("matches a term inside a word, which full-text cannot", () => {
    // 'red' is not a word in "Powdered", so plainto_tsquery never matches it.
    const { sql, params } = render(nameContains("red"));

    expect(sql).toContain("ILIKE");
    expect(params).toEqual(["%red%"]);
  });

  it("escapes LIKE metacharacters so they are searched for, not interpreted", () => {
    expect(toLikePattern("50%")).toBe("%50\\%%");
    expect(toLikePattern("a_b")).toBe("%a\\_b%");
    expect(toLikePattern("back\\slash")).toBe("%back\\\\slash%");
  });

  it("anchors the prefix pattern at the start only", () => {
    expect(toPrefixPattern("red")).toBe("red%");
    expect(toPrefixPattern("100%")).toBe("100\\%%");
  });

  it("is ORed alongside the three vectors rather than replacing them", () => {
    const [condition] = buildConditions({
      ...baseQuery,
      text: Option.some("red"),
    });

    const { sql } = render(condition!);

    expect(sql).toContain("search_vector");
    expect(sql).toContain("ILIKE");
    expect(sql).toContain(" or ");
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

  it("capitalizes finishes for display", () => {
    expect(finishLabel("matte")).toBe("Matte");
    expect(finishLabel("fluorescent")).toBe("Fluorescent");
  });
});
