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
export type LiftedFacet = "none" | "category" | "brand" | "price" | "rating" | "property";

/** The per-product rating aggregate, as the queries alias it. */
export type RatingColumns = Readonly<{ average: SQL; count: SQL }>;

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
   * name is also matched as a substring.
   */
  textCondition: (text: string): SQL =>
    sql`(${products.search} @@ ${ProductSearch.tsQuery(text)} OR ${products.name} ILIKE ${ProductSearch.likePattern(text)})`,

  /** A product carries `filter.name` with one of `filter.values`. */
  propertyCondition: (filter: PropertyFilter): SQL =>
    sql`EXISTS (SELECT 1 FROM ${productProperties} AS owned WHERE owned.product_id = ${products.id} AND owned.name = ${filter.name} AND ${inArray(sql`owned.value`, [...filter.values])})`,

  /**
   * Every active filter as a condition, except the one named by `lifted`.
   * With `property` lifted, each property filter still applies to every
   * property row except those of its own name, which is what lets one
   * property's facet count its sibling values.
   */
  conditions: (query: ProductQuery, rating: RatingColumns, lifted: LiftedFacet = "none"): SQL[] => {
    const where: SQL[] = [];

    if (query.text !== undefined) where.push(ProductSearch.textCondition(query.text));
    if (lifted !== "category" && query.category !== undefined) {
      where.push(eq(categories.slug, query.category));
    }
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

  /** `and` over the conditions, or nothing when there are none. */
  where: (conditions: readonly SQL[]): SQL | undefined =>
    conditions.length === 0 ? undefined : and(...conditions),

  /** Every sort ends in the slug, so paging is stable when keys tie. */
  orderBy: (query: ProductQuery, rating: RatingColumns): SQL[] => {
    switch (query.sort) {
      case "price_asc":
        return [asc(products.priceCents), asc(products.slug)];
      case "price_desc":
        return [desc(products.priceCents), asc(products.slug)];
      case "rating":
        return [desc(rating.average), desc(rating.count), asc(products.slug)];
      case "relevance":
        return query.text === undefined
          ? [asc(products.name), asc(products.slug)]
          : [
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
