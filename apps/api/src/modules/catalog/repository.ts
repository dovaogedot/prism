/**
 * Every database statement the catalog makes.
 *
 * Reads go through the `product_listing` view rather than the `product` table,
 * so a rating shown to a shopper is always the aggregate of the reviews that
 * exist at that moment. There is no cached rating column that could disagree.
 */

import type {
  Finish,
  ProductDetail,
  ProductFacets,
  ProductImage,
  ProductKind,
  ProductQuery,
  ProductReview,
  ProductSpec,
  ProductSummary,
  ShiftDirection,
  Suggestion,
} from "@prism/shared";
import {
  FINISHES,
  FINISH_LABELS,
  KIND_LABELS,
  Option,
  PRODUCT_KINDS,
} from "@prism/shared";
import { asc, count, desc, eq, inArray, min, max, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import {
  brands,
  productImages,
  productListing,
  productReviews,
  products,
  users,
} from "../../db/schema.ts";
import {
  buildConditions,
  buildOrderBy,
  combineConditions,
  type FacetDimension,
  finishCondition,
  RATING_THRESHOLDS,
  ratingFacetLabel,
  toOffset,
} from "./search.ts";
import { toMeasurements, toProductSpec } from "./spec.ts";

type ListingRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  stockQuantity: number;
  kind: ProductKind;
  hex: string | null;
  roughness: number | null;
  coatingNanometers: number | null;
  emission: number | null;
  hue: number | null;
  saturation: number | null;
  lightness: number | null;
  family: string | null;
  arcDegrees: number | null;
  direction: ShiftDirection | null;
  temperatureKelvin: number | null;
  reachCentimeters: number | null;
  grainMicrometers: number | null;
  finisherReachCentimeters: number | null;
  torqueMillinewtonMeters: number | null;
  backlashMicrometers: number | null;
  weightGrams: number;
  brandSlug: string;
  brandName: string;
  ratingAverage: number;
  ratingCount: number;
}>;

const LISTING_COLUMNS = {
  id: productListing.id,
  slug: productListing.slug,
  name: productListing.name,
  description: productListing.description,
  priceCents: productListing.priceCents,
  stockQuantity: productListing.stockQuantity,
  kind: productListing.kind,
  hex: productListing.hex,
  roughness: productListing.roughness,
  coatingNanometers: productListing.coatingNanometers,
  emission: productListing.emission,
  hue: productListing.hue,
  saturation: productListing.saturation,
  lightness: productListing.lightness,
  family: productListing.family,
  arcDegrees: productListing.arcDegrees,
  direction: productListing.direction,
  temperatureKelvin: productListing.temperatureKelvin,
  reachCentimeters: productListing.reachCentimeters,
  grainMicrometers: productListing.grainMicrometers,
  finisherReachCentimeters: productListing.finisherReachCentimeters,
  torqueMillinewtonMeters: productListing.torqueMillinewtonMeters,
  backlashMicrometers: productListing.backlashMicrometers,
  weightGrams: productListing.weightGrams,
  brandSlug: productListing.brandSlug,
  brandName: productListing.brandName,
  ratingAverage: productListing.ratingAverage,
  ratingCount: productListing.ratingCount,
} as const;

const mediaUrl = (filename: string): string => `/media/${filename}`;

const toSummary = (
  row: ListingRow,
  spec: ProductSpec,
  primaryImage: Option<ProductImage>,
): ProductSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  spec,
  // Read off the spec rather than the row, so it is the same value by
  // construction and not merely by both being right.
  category: spec.kind,
  priceCents: row.priceCents,
  stockQuantity: row.stockQuantity,
  brand: { slug: row.brandSlug, name: row.brandName },
  rating: { average: Number(row.ratingAverage), count: row.ratingCount },
  primaryImage,
});

/** One page of results, and how many there are in total behind it. */
export type SearchPage = Readonly<{
  items: readonly ProductSummary[];
  total: number;
}>;

/** Every read and write the catalog module makes against the database. */
export type CatalogRepository = Readonly<{
  search: (query: ProductQuery) => Promise<SearchPage>;
  facets: (query: ProductQuery) => Promise<ProductFacets>;
  findBySlug: (slug: string) => Promise<Option<ProductDetail>>;
  suggest: (term: string, limit: number) => Promise<readonly Suggestion[]>;
  findProductIdBySlug: (slug: string) => Promise<Option<string>>;
  addImage: (input: {
    productId: string;
    filename: string;
    alt: string;
  }) => Promise<ProductImage>;
}>;

/**
 * The repository over a real database.
 *
 * Reads go through the `product_listing` view, so a product arrives with its
 * rating and its measurements already computed.
 */
export const createCatalogRepository = (db: Database): CatalogRepository => {
  /** One extra query for all images on the page, rather than one per product. */
  const primaryImagesFor = async (
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProductImage>> => {
    if (productIds.length === 0) return new Map();

    const rows = await db
      .select({
        productId: productImages.productId,
        filename: productImages.filename,
        alt: productImages.alt,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, [...productIds]))
      .orderBy(asc(productImages.position));

    const byProduct = new Map<string, ProductImage>();

    for (const row of rows) {
      if (byProduct.has(row.productId)) continue;
      byProduct.set(row.productId, {
        url: mediaUrl(row.filename),
        alt: row.alt,
        position: row.position,
      });
    }

    return byProduct;
  };

  const countWhere = async (where: Option<SQL>): Promise<number> => {
    const rows = Option.isSome(where)
      ? await db.select({ total: count() }).from(productListing).where(where.value)
      : await db.select({ total: count() }).from(productListing);

    return rows[0]?.total ?? 0;
  };

  return {
    search: async (query) => {
      const where = combineConditions(buildConditions(query));
      const orderBy = buildOrderBy(query.sort, query.text);

      const base = db.select(LISTING_COLUMNS).from(productListing);
      const filtered = Option.isSome(where) ? base.where(where.value) : base;

      const rows = await filtered
        .orderBy(...orderBy)
        .limit(query.perPage)
        .offset(toOffset(query.page, query.perPage));

      const images = await primaryImagesFor(rows.map((row) => row.id));

      // `flatMap` over the spec, so a row the variant constraint could not have
      // produced is left out rather than shipped half-built. See `spec.ts`.
      const items = rows.flatMap((row) => {
        const spec = toProductSpec(row);

        return Option.isSome(spec)
          ? [toSummary(row, spec.value, Option.fromNullable(images.get(row.id)))]
          : [];
      });

      return { items, total: await countWhere(where) };
    },

    /**
     * Every dimension is counted against the filters from every *other*
     * dimension, so ticking a second brand widens the result rather than
     * emptying it.
     *
     * Counts are produced by joining *out* from the dimension's own table with
     * the filters in the ON clause, so a brand that matches nothing still comes
     * back with a count of zero. Putting them in a WHERE would drop the row
     * entirely and the filter rail would reflow every time a box was ticked.
     */
    facets: async (query) => {
      const whereExcept = (dimension: FacetDimension): Option<SQL> =>
        combineConditions(buildConditions(query, Option.some(dimension)));

      /** Applies a WHERE only when there is one, since Drizzle has no no-op. */
      const scoped = <A extends { where: (condition: SQL) => A }>(
        builder: A,
        where: Option<SQL>,
      ): A => (Option.isSome(where) ? builder.where(where.value) : builder);

      /** Matching rows only, so `count()` over the join yields 0, not 1. */
      const joinOn = (link: SQL, where: Option<SQL>): SQL =>
        Option.match<SQL, SQL>({
          onSome: (condition) => sql`${link} AND ${condition}`,
          onNone: () => link,
        })(where);

      /** The rating dimension's scope as a fragment usable inside FILTER. */
      const ratingScope: SQL = Option.match<SQL, SQL>({
        onSome: (condition) => condition,
        onNone: () => sql`TRUE`,
      })(whereExcept("rating"));

      /**
       * One finish counted over the scope that ignores the finish filter.
       *
       * `FILTER` rather than four statements: the four are four predicates
       * over the same rows, so one pass answers all of them.
       */
      const countWithin = (finish: Finish) =>
        sql<number>`count(*) FILTER (WHERE ${finishCondition(finish)})`.mapWith(Number);

      const [kindRows, brandRows, finishRow, summaryRows] = await Promise.all([
        scoped(
          db
            .select({ value: productListing.kind, total: count() })
            .from(productListing)
            .$dynamic(),
          whereExcept("kind"),
        ).groupBy(productListing.kind),

        db
          .select({
            value: brands.slug,
            label: brands.name,
            total: count(productListing.id),
          })
          .from(brands)
          .leftJoin(
            productListing,
            joinOn(
              sql`${productListing.brandId} = ${brands.id}`,
              whereExcept("brand"),
            ),
          )
          .groupBy(brands.slug, brands.name)
          .orderBy(asc(brands.name)),

        scoped(
          db
            .select({
              matte: countWithin("matte"),
              gloss: countWithin("gloss"),
              iridescent: countWithin("iridescent"),
              fluorescent: countWithin("fluorescent"),
            })
            .from(productListing)
            .$dynamic(),
          whereExcept("finish"),
        ),

        // Price extents and the cumulative rating tiers in one pass.
        //
        // The two want different scopes, which is why the rating filter is
        // interpolated into the FILTER clauses rather than applied as a WHERE:
        // price extents describe the whole catalog, so the slider's
        // endpoints stay put while it is dragged, while the rating tiers
        // describe the set narrowed by every *other* filter.
        //
        // `ratingScope` is a Drizzle SQL fragment, so its values are bound
        // parameters here exactly as they are in a WHERE — nothing is spliced
        // in as text.
        db
          .select({
            lowest: min(productListing.priceCents),
            highest: max(productListing.priceCents),
            atLeast5: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 5 AND ${ratingScope})`,
            atLeast4: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 4 AND ${ratingScope})`,
            atLeast3: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 3 AND ${ratingScope})`,
            atLeast2: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 2 AND ${ratingScope})`,
            atLeast1: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 1 AND ${ratingScope})`,
          })
          .from(productListing),
      ]);

      const summary = summaryRows[0];

      const cumulativeByThreshold: Record<(typeof RATING_THRESHOLDS)[number], number> = {
        5: Number(summary?.atLeast5 ?? 0),
        4: Number(summary?.atLeast4 ?? 0),
        3: Number(summary?.atLeast3 ?? 0),
        2: Number(summary?.atLeast2 ?? 0),
        1: Number(summary?.atLeast1 ?? 0),
      };

      // Every tier is returned, including empty ones — the rail must not
      // reflow as filters change.
      const ratings = RATING_THRESHOLDS.map((threshold) => ({
        value: String(threshold),
        label: ratingFacetLabel(threshold),
        count: cumulativeByThreshold[threshold],
      }));

      // Same for the categories: the universe is the enum, not whatever
      // matched.
      const kindCounts = new Map(
        kindRows.map((row) => [row.value, Number(row.total)]),
      );

      return {
        categories: PRODUCT_KINDS.map((kind) => ({
          value: kind,
          label: KIND_LABELS[kind],
          count: kindCounts.get(kind) ?? 0,
        })),
        brands: brandRows.map((row) => ({
          value: row.value,
          label: row.label,
          count: Number(row.total),
        })),
        finishes: FINISHES.map((finish) => ({
          value: finish,
          label: FINISH_LABELS[finish],
          count: finishRow[0]?.[finish] ?? 0,
        })),
        ratings,
        priceCents: {
          min: Number(summary?.lowest ?? 0),
          max: Number(summary?.highest ?? 0),
        },
      };
    },

    findBySlug: async (slug) => {
      const rows = await db
        .select(LISTING_COLUMNS)
        .from(productListing)
        .where(eq(productListing.slug, slug))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return Option.none;

      const spec = toProductSpec(row);
      const measurements = toMeasurements(row);
      if (Option.isNone(spec) || Option.isNone(measurements)) return Option.none;

      const [imageRows, reviewRows] = await Promise.all([
        db
          .select({
            filename: productImages.filename,
            alt: productImages.alt,
            position: productImages.position,
          })
          .from(productImages)
          .where(eq(productImages.productId, row.id))
          .orderBy(asc(productImages.position)),
        db
          .select({
            id: productReviews.id,
            rating: productReviews.rating,
            body: productReviews.body,
            email: users.email,
            createdAt: productReviews.createdAt,
          })
          .from(productReviews)
          .innerJoin(users, eq(users.id, productReviews.userId))
          .where(eq(productReviews.productId, row.id))
          .orderBy(desc(productReviews.createdAt))
          .limit(20),
      ]);

      const images: readonly ProductImage[] = imageRows.map((image) => ({
        url: mediaUrl(image.filename),
        alt: image.alt,
        position: image.position,
      }));

      const reviews: readonly ProductReview[] = reviewRows.map((review) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        // Reviews are public; the reviewer's address is not.
        authorInitial: review.email.slice(0, 1).toUpperCase(),
        createdAt: review.createdAt.toISOString(),
      }));

      const detail: ProductDetail = {
        ...toSummary(row, spec.value, Option.fromNullable(images[0])),
        description: row.description,
        measurements: measurements.value,
        images,
        reviews,
      };

      return Option.some(detail);
    },

    /**
     * Typeahead. Trigram similarity rather than full-text search, because a
     * shopper three letters into "screa…" has not yet typed a whole word and
     * `to_tsquery` has nothing to match on.
     */
    suggest: async (term, limit) => {
      const pattern = `%${term}%`;

      const [productRows, brandRows] = await Promise.all([
        db
          .select({
            slug: productListing.slug,
            label: productListing.name,
            hex: productListing.hex,
          })
          .from(productListing)
          .where(sql`${productListing.name} ILIKE ${pattern}`)
          .orderBy(
            desc(sql`similarity(${productListing.name}, ${term})`),
            asc(productListing.name),
          )
          .limit(limit),
        db
          .selectDistinct({
            slug: productListing.brandSlug,
            label: productListing.brandName,
          })
          .from(productListing)
          .where(sql`${productListing.brandName} ILIKE ${pattern}`)
          .limit(3),
      ]);

      const suggestions: Suggestion[] = [
        ...productRows.map(
          (row): Suggestion => ({
            kind: "product",
            label: row.label,
            slug: row.slug,
            // A finisher or a shifter has no swatch to preview.
            hex: Option.fromNullable(row.hex),
          }),
        ),
        ...brandRows.map(
          (row): Suggestion => ({
            kind: "brand",
            label: row.label,
            slug: row.slug,
            hex: Option.none,
          }),
        ),
      ];

      return suggestions.slice(0, limit);
    },

    findProductIdBySlug: async (slug) => {
      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, slug))
        .limit(1);

      return Option.map((row: { id: string }) => row.id)(
        Option.fromNullable(rows[0]),
      );
    },

    addImage: async ({ productId, filename, alt }) => {
      const existing = await db
        .select({ total: count() })
        .from(productImages)
        .where(eq(productImages.productId, productId));

      const position = existing[0]?.total ?? 0;

      await db
        .insert(productImages)
        .values({ productId, filename, alt, position });

      return { url: mediaUrl(filename), alt, position };
    },
  };
};
