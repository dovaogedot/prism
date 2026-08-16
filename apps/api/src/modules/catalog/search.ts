/**
 * Search and facet SQL, built as pure functions.
 *
 * Nothing here touches a connection: a `ProductQuery` goes in and Drizzle `SQL`
 * fragments come out, which is what lets the unit tests assert on the generated
 * statement and its parameters without a database.
 *
 * Every user-supplied value arrives as a bound parameter. There is no string
 * concatenation of input anywhere in this file, which is what makes the
 * injection tests boring.
 */

import type { Finish, NumericRange, ProductQuery, ProductSort } from "@prism/shared";
import { Option } from "@prism/shared";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { productListing } from "../../db/schema.ts";

/**
 * `plainto_tsquery` treats the input as words to be ANDed and escapes the
 * operators itself, so `red & | !` is a search for the word "red" rather than
 * a syntax error or an injection.
 */
export const toTsQuery = (text: string): SQL =>
  sql`plainto_tsquery('english', ${text})`;

/**
 * Escapes the LIKE metacharacters so a search for `50%` looks for the string
 * `50%` rather than for anything starting with `50`.
 */
export const toLikePattern = (text: string): string =>
  `%${text.replace(/([\\%_])/g, "\\$1")}%`;

export const toPrefixPattern = (text: string): string =>
  `${text.replace(/([\\%_])/g, "\\$1")}%`;

/**
 * Full-text search matches whole words: `plainto_tsquery('english', 'red')`
 * finds "Reds" (same stem) but never "Powdered", because `red` is not a word
 * in it. A shopper typing "red" reasonably expects both.
 *
 * So the name is also matched as a substring, using the trigram GIN index
 * that already exists for the typeahead. Full-text stays for the ranked,
 * word-aware half; the substring covers the literal half.
 */
export const nameContains = (text: string): SQL =>
  sql`${productListing.name} ILIKE ${toLikePattern(text)}`;

/**
 * A category filter includes everything beneath it — asking for "Reds" must
 * return the colors filed under "Reds → Crimsons". The recursive CTE walks
 * down from the named slug.
 */
export const descendantCategoryIds = (slug: string): SQL =>
  sql`(
    WITH RECURSIVE subtree AS (
      SELECT id FROM category WHERE slug = ${slug}
      UNION ALL
      SELECT child.id FROM category child JOIN subtree ON child.parent_id = subtree.id
    )
    SELECT id FROM subtree
  )`;

/**
 * Searching for a category name means the same thing as filtering by it: the
 * whole subtree.
 *
 * Only leaf categories hold products, so matching a product against its own
 * category alone makes a parent name unfindable — typing "yellows" would return
 * nothing at all, even though "Yellows → Golds" is full of colors and the
 * typeahead happily offers the parent. Matching first, then walking down, puts
 * the two paths back in agreement.
 *
 * This subsumes the leaf case: a category that matches is in the result set
 * before the recursive term ever runs.
 */
export const categorySubtreeMatching = (text: string): SQL =>
  sql`(
    WITH RECURSIVE matched AS (
      SELECT id FROM category WHERE search_vector @@ ${toTsQuery(text)}
      UNION ALL
      SELECT child.id FROM category child JOIN matched ON child.parent_id = matched.id
    )
    SELECT id FROM matched
  )`;

/**
 * Hue is a circle, so a range whose start exceeds its end is the arc that
 * crosses 0° — which is exactly where the reds are. Any other range is a
 * plain interval.
 */
export const hueCondition = (range: NumericRange): SQL => {
  const wrapsAroundZero = range.min > range.max;

  return wrapsAroundZero
    ? sql`(${productListing.hue} >= ${range.min} OR ${productListing.hue} <= ${range.max})`
    : sql`(${productListing.hue} BETWEEN ${range.min} AND ${range.max})`;
};

export type FacetDimension = "category" | "brand" | "finish" | "rating" | "price";

/**
 * Conditions for a query, optionally omitting one dimension.
 *
 * Facet counts must be computed against everything *except* their own filter,
 * or selecting one brand would show every other brand with a count of zero and
 * multi-select would be impossible.
 */
export const buildConditions = (
  query: ProductQuery,
  exclude: Option<FacetDimension> = Option.none,
): readonly SQL[] => {
  const omitted = Option.match<FacetDimension, FacetDimension | "none">({
    onSome: (dimension) => dimension,
    onNone: () => "none",
  })(exclude);

  const conditions: SQL[] = [];

  if (Option.isSome(query.text)) {
    const tsQuery = toTsQuery(query.text.value);
    const matches = or(
      sql`${productListing.searchVector} @@ ${tsQuery}`,
      sql`${productListing.brandSearchVector} @@ ${tsQuery}`,
      sql`${productListing.categoryId} IN ${categorySubtreeMatching(query.text.value)}`,
      nameContains(query.text.value),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  if (omitted !== "category" && Option.isSome(query.categorySlug)) {
    conditions.push(
      sql`${productListing.categoryId} IN ${descendantCategoryIds(query.categorySlug.value)}`,
    );
  }

  if (omitted !== "brand" && query.brandSlugs.length > 0) {
    conditions.push(inArray(productListing.brandSlug, [...query.brandSlugs]));
  }

  if (omitted !== "finish" && query.finishes.length > 0) {
    conditions.push(inArray(productListing.finish, [...query.finishes]));
  }

  if (omitted !== "price" && Option.isSome(query.price)) {
    conditions.push(gte(productListing.priceCents, query.price.value.min));
    conditions.push(lte(productListing.priceCents, query.price.value.max));
  }

  if (omitted !== "rating" && Option.isSome(query.minRating)) {
    conditions.push(gte(productListing.ratingAverage, query.minRating.value));
  }

  if (Option.isSome(query.hue)) {
    conditions.push(hueCondition(query.hue.value));
  }

  if (Option.isSome(query.saturation)) {
    conditions.push(gte(productListing.saturation, query.saturation.value.min));
    conditions.push(lte(productListing.saturation, query.saturation.value.max));
  }

  if (Option.isSome(query.lightness)) {
    conditions.push(gte(productListing.lightness, query.lightness.value.min));
    conditions.push(lte(productListing.lightness, query.lightness.value.max));
  }

  return conditions;
};

export const combineConditions = (conditions: readonly SQL[]): Option<SQL> =>
  conditions.length === 0 ? Option.none : Option.fromNullable(and(...conditions));

/**
 * Weighted relevance across the three vectors: a hit on the color's own name
 * outranks a hit on its foundry, which outranks a hit on its category.
 */
export const relevanceExpression = (text: string): SQL => {
  const tsQuery = toTsQuery(text);

  // A literal hit in the color's own name is the strongest signal there is,
  // and one at the start of the name is stronger still — somebody typing
  // "red" wants "Red Ochre" before "Powdered Rosé". Those two terms sit well
  // above the ts_rank_cd scores, which land in the 0.0–0.2 range.
  return sql`(
    CASE WHEN ${productListing.name} ILIKE ${toPrefixPattern(text)} THEN 2 ELSE 0 END
    + CASE WHEN ${productListing.name} ILIKE ${toLikePattern(text)} THEN 1 ELSE 0 END
    + ts_rank_cd(${productListing.searchVector}, ${tsQuery}) * 4
    + ts_rank_cd(${productListing.brandSearchVector}, ${tsQuery}) * 2
    + ts_rank_cd(${productListing.categorySearchVector}, ${tsQuery})
  )`;
};

/**
 * Ordering. Every sort ends with the slug so that pagination is stable — two
 * colors at the same price must not swap places between page 1 and page 2.
 */
export const buildOrderBy = (
  sort: ProductSort,
  text: Option<string>,
): readonly SQL[] => {
  const stable = asc(productListing.slug);

  switch (sort) {
    case "relevance":
      // With no search term there is nothing to be relevant to, so the most
      // recently stocked colors lead instead.
      return Option.isSome(text)
        ? [desc(relevanceExpression(text.value)), stable]
        : [desc(productListing.createdAt), stable];
    case "price_asc":
      return [asc(productListing.priceCents), stable];
    case "price_desc":
      return [desc(productListing.priceCents), stable];
    case "rating":
      return [
        desc(productListing.ratingAverage),
        desc(productListing.ratingCount),
        stable,
      ];
  }
};

/**
 * Five is included so the top star is selectable. Nothing rates above five,
 * so "5 & up" is exactly five — which is what a shopper clicking the last
 * star means. Without this entry the button has no count and stays disabled.
 */
export const RATING_THRESHOLDS = [5, 4, 3, 2, 1] as const;

export const ratingFacetLabel = (threshold: number): string =>
  // "5 stars & up" would be a lie about a scale that stops at five.
  threshold === 5
    ? "5 stars"
    : `${threshold} star${threshold === 1 ? "" : "s"} & up`;

export const finishLabel = (finish: Finish): string =>
  finish.charAt(0).toUpperCase() + finish.slice(1);

/** Page numbers are 1-based at the edge and 0-based in SQL. */
export const toOffset = (page: number, perPage: number): number =>
  (page - 1) * perPage;

export const toTotalPages = (total: number, perPage: number): number =>
  total === 0 ? 0 : Math.ceil(total / perPage);
