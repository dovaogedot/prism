/**
 * Every database statement the catalogue makes.
 *
 * Reads go through the `product_listing` view rather than the `product` table,
 * so a rating shown to a shopper is always the aggregate of the reviews that
 * exist at that moment. There is no cached rating column that could disagree.
 */

import type {
  CategoryNode,
  Finish,
  ProductDetail,
  ProductFacets,
  ProductImage,
  ProductQuery,
  ProductReview,
  ProductSummary,
  Suggestion,
} from "@hue/shared";
import { measure, Option } from "@hue/shared";
import { asc, count, desc, eq, inArray, min, max, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import {
  categories,
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
  finishLabel,
  RATING_THRESHOLDS,
  ratingFacetLabel,
  toOffset,
} from "./search.ts";

type ListingRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  stockQuantity: number;
  hex: string;
  finish: Finish;
  hue: number;
  saturation: number;
  lightness: number;
  weightGrams: number;
  lengthMillimetres: number;
  widthMillimetres: number;
  heightMillimetres: number;
  brandSlug: string;
  brandName: string;
  categorySlug: string;
  categoryName: string;
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
  hex: productListing.hex,
  finish: productListing.finish,
  hue: productListing.hue,
  saturation: productListing.saturation,
  lightness: productListing.lightness,
  weightGrams: productListing.weightGrams,
  lengthMillimetres: productListing.lengthMillimetres,
  widthMillimetres: productListing.widthMillimetres,
  heightMillimetres: productListing.heightMillimetres,
  brandSlug: productListing.brandSlug,
  brandName: productListing.brandName,
  categorySlug: productListing.categorySlug,
  categoryName: productListing.categoryName,
  ratingAverage: productListing.ratingAverage,
  ratingCount: productListing.ratingCount,
} as const;

const mediaUrl = (filename: string): string => `/media/${filename}`;

const toSummary = (
  row: ListingRow,
  primaryImage: Option<ProductImage>,
): ProductSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  hex: row.hex,
  finish: row.finish,
  priceCents: row.priceCents,
  stockQuantity: row.stockQuantity,
  brand: { slug: row.brandSlug, name: row.brandName },
  category: { slug: row.categorySlug, name: row.categoryName },
  rating: { average: Number(row.ratingAverage), count: row.ratingCount },
  primaryImage,
});

export type SearchPage = Readonly<{
  items: readonly ProductSummary[];
  total: number;
}>;

export type CatalogRepository = Readonly<{
  search: (query: ProductQuery) => Promise<SearchPage>;
  facets: (query: ProductQuery) => Promise<ProductFacets>;
  findBySlug: (slug: string) => Promise<Option<ProductDetail>>;
  categoryTree: () => Promise<readonly CategoryNode[]>;
  suggest: (term: string, limit: number) => Promise<readonly Suggestion[]>;
  findProductIdBySlug: (slug: string) => Promise<Option<string>>;
  addImage: (input: {
    productId: string;
    filename: string;
    alt: string;
  }) => Promise<ProductImage>;
}>;

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

      return {
        items: rows.map((row) =>
          toSummary(row, Option.fromNullable(images.get(row.id))),
        ),
        total: await countWhere(where),
      };
    },

    /**
     * Each dimension is counted against the filters from every *other*
     * dimension, so ticking a second brand widens the result rather than
     * emptying it. The five queries run concurrently.
     */
    facets: async (query) => {
      const whereExcept = (dimension: FacetDimension): Option<SQL> =>
        combineConditions(buildConditions(query, Option.some(dimension)));

      /** Applies a WHERE only when there is one, since Drizzle has no no-op. */
      const scoped = <A extends { where: (condition: SQL) => A }>(
        builder: A,
        where: Option<SQL>,
      ): A => (Option.isSome(where) ? builder.where(where.value) : builder);

      const [categoryRows, brandRows, finishRows, summaryRows] = await Promise.all([
        scoped(
          db
            .select({
              value: productListing.categorySlug,
              label: productListing.categoryName,
              total: count(),
            })
            .from(productListing)
            .$dynamic(),
          whereExcept("category"),
        )
          .groupBy(productListing.categorySlug, productListing.categoryName)
          .orderBy(desc(count())),

        scoped(
          db
            .select({
              value: productListing.brandSlug,
              label: productListing.brandName,
              total: count(),
            })
            .from(productListing)
            .$dynamic(),
          whereExcept("brand"),
        )
          .groupBy(productListing.brandSlug, productListing.brandName)
          .orderBy(desc(count())),

        scoped(
          db
            .select({ value: productListing.finish, total: count() })
            .from(productListing)
            .$dynamic(),
          whereExcept("finish"),
        )
          .groupBy(productListing.finish)
          .orderBy(desc(count())),

        // Price bounds and the cumulative rating tiers in one pass. FILTER is
        // what makes "4 stars & up" a column rather than four round trips.
        scoped(
          db
            .select({
              lowest: min(productListing.priceCents),
              highest: max(productListing.priceCents),
              atLeast4: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 4)`,
              atLeast3: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 3)`,
              atLeast2: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 2)`,
              atLeast1: sql<number>`count(*) FILTER (WHERE ${productListing.ratingAverage} >= 1)`,
            })
            .from(productListing)
            .$dynamic(),
          whereExcept("rating"),
        ),
      ]);

      const summary = summaryRows[0];

      const cumulativeByThreshold: Record<(typeof RATING_THRESHOLDS)[number], number> = {
        4: Number(summary?.atLeast4 ?? 0),
        3: Number(summary?.atLeast3 ?? 0),
        2: Number(summary?.atLeast2 ?? 0),
        1: Number(summary?.atLeast1 ?? 0),
      };

      const ratings = RATING_THRESHOLDS.map((threshold) => ({
        value: String(threshold),
        label: ratingFacetLabel(threshold),
        count: cumulativeByThreshold[threshold],
      })).filter((bucket) => bucket.count > 0);

      const priceRow = summary;

      return {
        categories: categoryRows.map((row) => ({
          value: row.value,
          label: row.label,
          count: Number(row.total),
        })),
        brands: brandRows.map((row) => ({
          value: row.value,
          label: row.label,
          count: Number(row.total),
        })),
        finishes: finishRows.map((row) => ({
          value: row.value,
          label: finishLabel(row.value),
          count: Number(row.total),
        })),
        ratings,
        priceCents: {
          min: Number(priceRow?.lowest ?? 0),
          max: Number(priceRow?.highest ?? 0),
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
        ...toSummary(row, Option.fromNullable(images[0])),
        description: row.description,
        measurements: measure({
          weightGrams: row.weightGrams,
          lengthMillimetres: row.lengthMillimetres,
          widthMillimetres: row.widthMillimetres,
          heightMillimetres: row.heightMillimetres,
        }),
        hue: row.hue,
        saturation: row.saturation,
        lightness: row.lightness,
        images,
        reviews,
      };

      return Option.some(detail);
    },

    categoryTree: async () => {
      const rows = await db
        .select({
          id: categories.id,
          slug: categories.slug,
          name: categories.name,
          parentId: categories.parentId,
          position: categories.position,
        })
        .from(categories)
        .orderBy(asc(categories.position), asc(categories.name));

      // Counts are per subtree, so a parent shows everything filed beneath it.
      const counts = await db
        .select({
          categorySlug: productListing.categorySlug,
          total: count(),
        })
        .from(productListing)
        .groupBy(productListing.categorySlug);

      const directCounts = new Map(
        counts.map((row) => [row.categorySlug, Number(row.total)]),
      );

      const childrenOf = new Map<string | null, typeof rows>();
      for (const row of rows) {
        const siblings = childrenOf.get(row.parentId) ?? [];
        siblings.push(row);
        childrenOf.set(row.parentId, siblings);
      }

      const build = (parentId: string | null): readonly CategoryNode[] =>
        (childrenOf.get(parentId) ?? []).map((row) => {
          const children = build(row.id);
          const subtreeTotal =
            (directCounts.get(row.slug) ?? 0) +
            children.reduce((sum, child) => sum + child.productCount, 0);

          return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            productCount: subtreeTotal,
            children,
          };
        });

      return build(null);
    },

    /**
     * Typeahead. Trigram similarity rather than full-text search, because a
     * shopper three letters into "screa…" has not yet typed a whole word and
     * `to_tsquery` has nothing to match on.
     */
    suggest: async (term, limit) => {
      const pattern = `%${term}%`;

      const [productRows, brandRows, categoryRows] = await Promise.all([
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
        db
          .select({ slug: categories.slug, label: categories.name })
          .from(categories)
          .where(sql`${categories.name} ILIKE ${pattern}`)
          .limit(3),
      ]);

      const suggestions: Suggestion[] = [
        ...productRows.map(
          (row): Suggestion => ({
            kind: "product",
            label: row.label,
            slug: row.slug,
            hex: Option.some(row.hex),
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
        ...categoryRows.map(
          (row): Suggestion => ({
            kind: "category",
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
