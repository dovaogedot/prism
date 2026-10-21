/**
 * Search SQL as pure functions: a `ProductQuery` goes in and drizzle
 * fragments come out, so the unit tests can assert on the statement and its
 * bound parameters without a database. Every value a shopper supplies is a
 * bound parameter; nothing is concatenated into the statement.
 */

import type { ProductQuery, PropertyFilter } from "@prism/shared";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { brands, categories, productProperties, products } from "../../db/schema.ts";

/**
 * The facet whose own filter a condition list leaves out, so the facet can
 * count what choosing another of its values would match.
 */
export type LiftedFacet = "none" | "brand" | "price" | "rating" | "property";

/** The per-product rating aggregate, as the queries alias it. */
export type RatingColumns = Readonly<{ average: SQL; count: SQL }>;

/**
 * How the search text matches: `exact` finds its words and its substring;
 * `similar` finds names whose trigrams resemble it, which is what catches a
 * misspelling once nothing matched exactly.
 */
export type TextMatch = "exact" | "similar";

export const ProductSearch = {
  RATING_THRESHOLDS: [5, 4, 3, 2, 1] as const,

  /** What a rating threshold reads as in the facet rail. */
  ratingLabel: (threshold: number): string =>
    threshold >= 5 ? "5 stars" : `${threshold} stars & up`,

  /**
   * `plainto_tsquery` treats the input as words to AND together and escapes
   * the operators itself, so `red & | !` searches for the word "red".
   */
  tsQuery: (text: string): SQL => sql`plainto_tsquery('english', ${text})`,

  /** LIKE metacharacters escaped, so `50%` looks for the string `50%`. */
  likePattern: (text: string): string => `%${text.replace(/[\\%_]/g, "\\$&")}%`,
  prefixPattern: (text: string): string => `${text.replace(/[\\%_]/g, "\\$&")}%`,

  /**
   * Full-text search matches whole words and stems, never a fragment, so the
   * name is also matched as a substring. A similar match uses pg_trgm's `%`,
   * which the trigram index of the name answers.
   */
  textCondition: (text: string, match: TextMatch = "exact"): SQL =>
    match === "similar"
      ? sql`${products.name} % ${text}`
      : sql`(${products.search} @@ ${ProductSearch.tsQuery(text)} OR ${products.name} ILIKE ${ProductSearch.likePattern(text)})`,

  /** A product carries `filter.name` with one of `filter.values`. */
  propertyCondition: (filter: PropertyFilter): SQL =>
    sql`EXISTS (SELECT 1 FROM ${productProperties} AS owned WHERE owned.product_id = ${products.id} AND owned.name = ${filter.name} AND ${inArray(sql`owned.value`, [...filter.values])})`,

  /**
   * The filters that define the shelf: the text and the category. Every
   * facet but the categories lists its values over the shelf, so a value
   * stays in view when a filter of the rail excludes it.
   */
  shelf: (query: ProductQuery, match: TextMatch = "exact"): SQL[] => {
    const where: SQL[] = [];

    if (query.text !== undefined) where.push(ProductSearch.textCondition(query.text, match));
    if (query.category !== undefined) where.push(eq(categories.slug, query.category));

    return where;
  },

  /**
   * The filters the rail applies within the shelf, except the one named by
   * `lifted`. A facet counts its values under these. With `property` lifted,
   * each property filter still applies to every property row except those
   * of its own name, which is what lets one property's facet count its
   * sibling values.
   */
  narrowing: (query: ProductQuery, rating: RatingColumns, lifted: LiftedFacet = "none"): SQL[] => {
    const where: SQL[] = [];

    if (lifted !== "brand" && query.brands.length > 0) where.push(inArray(brands.slug, [...query.brands]));
    if (lifted !== "price" && query.priceMinCents !== undefined) {
      where.push(gte(products.priceCents, query.priceMinCents));
    }
    if (lifted !== "price" && query.priceMaxCents !== undefined) {
      where.push(lte(products.priceCents, query.priceMaxCents));
    }
    if (lifted !== "rating" && query.minRating !== undefined) {
      where.push(sql`${rating.average} >= ${query.minRating}`);
    }

    for (const filter of query.properties) {
      const owns = ProductSearch.propertyCondition(filter);
      const condition =
        lifted === "property" ? or(eq(productProperties.name, filter.name), owns) : owns;
      if (condition !== undefined) where.push(condition);
    }

    return where;
  },

  /** Every active filter as a condition, except the one named by `lifted`. */
  conditions: (query: ProductQuery, rating: RatingColumns, lifted: LiftedFacet = "none", match: TextMatch = "exact"): SQL[] => [
    ...ProductSearch.shelf(query, match),
    ...ProductSearch.narrowing(query, rating, lifted),
  ],

  /** The conditions as one boolean for a `FILTER` clause; `true` when there are none. */
  filter: (conditions: readonly SQL[]): SQL => and(...conditions) ?? sql`true`,

  /** `and` over the conditions, or nothing when there are none. */
  where: (conditions: readonly SQL[]): SQL | undefined =>
    conditions.length === 0 ? undefined : and(...conditions),

  /** Every sort ends in the slug, so paging is stable when keys tie. */
  orderBy: (query: ProductQuery, rating: RatingColumns, match: TextMatch = "exact"): SQL[] => {
    switch (query.sort) {
      case "newest":
        return [desc(products.createdAt), asc(products.slug)];
      case "price_asc":
        return [asc(products.priceCents), asc(products.slug)];
      case "price_desc":
        return [desc(products.priceCents), asc(products.slug)];
      case "rating":
        return [desc(rating.average), desc(rating.count), asc(products.slug)];
      case "relevance":
        if (query.text !== undefined && match === "similar") {
          return [desc(sql`similarity(${products.name}, ${query.text})`), asc(products.name), asc(products.slug)];
        }
        return query.text === undefined
          ? [asc(products.name), asc(products.slug)]
          : [
              // A product named exactly what was typed comes first, then the best full-text matches.
              desc(sql`lower(${products.name}) = lower(${query.text})`),
              desc(sql`ts_rank(${products.search}, ${ProductSearch.tsQuery(query.text)})`),
              asc(products.name),
              asc(products.slug),
            ];
    }
  },

  /** Typed prefixes first, then any other substring match, alphabetically. */
  suggestionOrder: (text: string): SQL[] => [
    desc(ilike(products.name, ProductSearch.prefixPattern(text))),
    asc(products.name),
  ],

  offset: (query: ProductQuery): number => (query.page - 1) * query.perPage,

  totalPages: (total: number, perPage: number): number => Math.max(1, Math.ceil(total / perPage)),
} as const;
