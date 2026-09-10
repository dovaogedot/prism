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

import type {
  Finish,
  FinishProperty,
  NumericRange,
  ProductQuery,
  ProductSort,
} from "@prism/shared";
import { FINISH_BANDS, FINISHES, Option } from "@prism/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
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

/** The same escaping, anchored at the start, for a term the shopper is still typing. */
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

/** A filter that has its own facet, and can therefore be lifted to count it. */
export type FacetDimension = "kind" | "brand" | "finish" | "rating" | "price";

/** The column each of the three amounts lives in. */
const FINISH_COLUMNS = {
  roughness: productListing.roughness,
  coating: productListing.coatingNanometers,
  emission: productListing.emission,
} as const satisfies Record<FinishProperty, unknown>;

/** Every one of `conditions`, which every row meets when there are none. */
const allOf = (conditions: readonly SQL[]): SQL =>
  conditions.length === 0 ? sql`TRUE` : sql`(${sql.join([...conditions], sql` AND `)})`;

/** Any one of `conditions`, which no row meets when there are none. */
const anyOf = (conditions: readonly SQL[]): SQL =>
  conditions.length === 0 ? sql`FALSE` : sql`(${sql.join([...conditions], sql` OR `)})`;

/** `column` inside `range`, both ends included. */
const between = (column: SQLWrapper, range: NumericRange): SQL =>
  sql`${column} BETWEEN ${range.min} AND ${range.max}`;

/** `column` inside `range`, or no condition at all while the query sets none. */
const rangeOn = (column: SQLWrapper, range: Option<NumericRange>): readonly SQL[] =>
  Option.isSome(range) ? [between(column, range.value)] : [];

/**
 * The finishers that apply `finish`, at an amount inside the range `query`
 * puts on that amount.
 *
 * A finisher does one thing, and the column that is present is which one — so
 * asking for the iridescent ones is asking which rows have a coating at all.
 * No threshold recovers it and nothing has to agree about where one finish
 * becomes another.
 *
 * Scoped to finishers, because a color carries all three amounts at once and
 * has no single answer to which finish it is.
 */
export const finishCondition = (finish: Finish, query: ProductQuery): SQL => {
  const band = FINISH_BANDS[finish];
  const column = FINISH_COLUMNS[band.property];

  return allOf([
    eq(productListing.kind, "finisher"),
    isNotNull(column),
    between(column, band.range),
    ...rangeOn(column, query[band.property]),
  ]);
};

/**
 * Conditions for a query, optionally omitting one dimension.
 *
 * Facet counts must be computed against everything *except* their own filter,
 * or selecting one brand would show every other brand with a count of zero and
 * multi-select would be impossible.
 *
 * Omitting `kind` drops more than the kind filter: it drops every filter only
 * one kind can satisfy. Counting how many shifters exist while an arc range is
 * applied is a fair question; counting how many *colors* satisfy that arc is
 * not — no color has an arc, so the answer would be zero for a reason that has
 * nothing to do with the shopper's question. Those filters belong to the
 * category, so they leave with it.
 */
export const buildConditions = (
  query: ProductQuery,
  exclude: Option<FacetDimension> = Option.none,
): readonly SQL[] => {
  const omitted = Option.match<FacetDimension, FacetDimension | "none">({
    onSome: (dimension) => dimension,
    onNone: () => "none",
  })(exclude);

  const acrossKinds = omitted === "kind";
  // Only the finishes have a facet to count, so only they are lifted for it.
  // The three amounts have no counts of their own to distort, but they belong
  // to the finishes that are chosen and leave with them.
  const acrossFinishes = acrossKinds || omitted === "finish";
  // While finishes are asked for, each range is part of the finish whose
  // amount it is rather than a condition of its own. A finisher carries that
  // one amount and nothing in the other two columns, so a roughness range on
  // every row would drop the coating finishers ticked beside the grain.
  const finishing = !acrossFinishes && query.finishes.length > 0;
  const amountsApart = !acrossFinishes && !finishing;
  const conditions: SQL[] = [];

  if (Option.isSome(query.text)) {
    const tsQuery = toTsQuery(query.text.value);
    const matches = or(
      sql`${productListing.searchVector} @@ ${tsQuery}`,
      sql`${productListing.brandSearchVector} @@ ${tsQuery}`,
      nameContains(query.text.value),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  if (!acrossKinds && Option.isSome(query.kind)) {
    conditions.push(eq(productListing.kind, query.kind.value));
  }

  // No facet, so nothing lifts it: a family is what a typed word resolves to
  // rather than something offered in the rail.
  if (Option.isSome(query.family)) {
    conditions.push(eq(productListing.family, query.family.value));
  }

  if (omitted !== "brand" && query.brandSlugs.length > 0) {
    conditions.push(inArray(productListing.brandSlug, [...query.brandSlugs]));
  }

  if (finishing) {
    conditions.push(
      anyOf(
        FINISHES.filter((finish) => query.finishes.includes(finish)).map((finish) =>
          finishCondition(finish, query),
        ),
      ),
    );
  }

  if (omitted !== "price" && Option.isSome(query.price)) {
    conditions.push(gte(productListing.priceCents, query.price.value.min));
    conditions.push(lte(productListing.priceCents, query.price.value.max));
  }

  if (omitted !== "rating" && Option.isSome(query.minRating)) {
    conditions.push(gte(productListing.ratingAverage, query.minRating.value));
  }

  if (!acrossKinds && Option.isSome(query.hue)) {
    conditions.push(hueCondition(query.hue.value));
  }

  if (!acrossKinds && Option.isSome(query.saturation)) {
    conditions.push(gte(productListing.saturation, query.saturation.value.min));
    conditions.push(lte(productListing.saturation, query.saturation.value.max));
  }

  if (!acrossKinds && Option.isSome(query.lightness)) {
    conditions.push(gte(productListing.lightness, query.lightness.value.min));
    conditions.push(lte(productListing.lightness, query.lightness.value.max));
  }

  // The three amounts a finish is made of, which a color has and a finisher
  // puts back. Independent of each other, so narrowing one says nothing about
  // the other two. While finishes are asked for they are inside the finishes
  // above instead. They leave with the finish as well as with the category:
  // each finish is counted within the range on its own amount, and a
  // roughness range on every row would count the fluorescent finishers as
  // zero for a reason that has nothing to do with the shopper's question.
  if (amountsApart && Option.isSome(query.roughness)) {
    conditions.push(gte(productListing.roughness, query.roughness.value.min));
    conditions.push(lte(productListing.roughness, query.roughness.value.max));
  }

  if (amountsApart && Option.isSome(query.coating)) {
    conditions.push(gte(productListing.coatingNanometers, query.coating.value.min));
    conditions.push(lte(productListing.coatingNanometers, query.coating.value.max));
  }

  if (amountsApart && Option.isSome(query.emission)) {
    conditions.push(gte(productListing.emission, query.emission.value.min));
    conditions.push(lte(productListing.emission, query.emission.value.max));
  }

  if (!acrossKinds && Option.isSome(query.direction)) {
    conditions.push(eq(productListing.direction, query.direction.value));
  }

  if (!acrossKinds && Option.isSome(query.arc)) {
    conditions.push(gte(productListing.arcDegrees, query.arc.value.min));
    conditions.push(lte(productListing.arcDegrees, query.arc.value.max));
  }

  return conditions;
};

/** Every condition ANDed together, or `None` when there is nothing to filter by. */
export const combineConditions = (conditions: readonly SQL[]): Option<SQL> =>
  conditions.length === 0 ? Option.none : Option.fromNullable(and(...conditions));

/**
 * Weighted relevance across the two vectors: a hit on the product's own name
 * outranks a hit on its foundry.
 */
export const relevanceExpression = (text: string): SQL => {
  const tsQuery = toTsQuery(text);

  // A literal hit in the color's own name is the strongest signal there is,
  // and one at the start of the name is stronger still — somebody typing
  // "red" wants "Red Ocher" before "Powdered Rosé". Those two terms sit well
  // above the ts_rank_cd scores, which land in the 0.0–0.2 range.
  return sql`(
    CASE WHEN ${productListing.name} ILIKE ${toPrefixPattern(text)} THEN 2 ELSE 0 END
    + CASE WHEN ${productListing.name} ILIKE ${toLikePattern(text)} THEN 1 ELSE 0 END
    + ts_rank_cd(${productListing.searchVector}, ${tsQuery}) * 4
    + ts_rank_cd(${productListing.brandSearchVector}, ${tsQuery}) * 2
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

/** How a rating bucket is written out in the filter rail. */
export const ratingFacetLabel = (threshold: number): string =>
  // "5 stars & up" would be a lie about a scale that stops at five.
  threshold === 5
    ? "5 stars"
    : `${threshold} star${threshold === 1 ? "" : "s"} & up`;

/** Page numbers are 1-based at the edge and 0-based in SQL. */
export const toOffset = (page: number, perPage: number): number =>
  (page - 1) * perPage;

/** How many pages a result set fills. Nothing found is no pages, not one empty one. */
export const toTotalPages = (total: number, perPage: number): number =>
  total === 0 ? 0 : Math.ceil(total / perPage);
