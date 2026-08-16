/**
 * Every database statement the catalog makes.
 *
 * Reads go through the `product_listing` view rather than the `product` table,
 * so a rating shown to a shopper is always the aggregate of the reviews that
 * exist at that moment. There is no cached rating column that could disagree.
 */

import type {
  CategoryNode,
  CategoryRef,
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
import { FINISHES, KIND_LABELS, Option, PRODUCT_KINDS } from "@prism/shared";
import { asc, count, desc, eq, inArray, min, max, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import {
  brands,
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
  finish: Finish | null;
  hue: number | null;
  saturation: number | null;
  lightness: number | null;
  durability: number | null;
  arcDegrees: number | null;
  direction: ShiftDirection | null;
  temperatureKelvin: number | null;
  reachCentimeters: number | null;
  coverageSquareCentimeters: number | null;
  grainMicrometers: number | null;
  torqueMillinewtonMeters: number | null;
  backlashMicrometers: number | null;
  weightGrams: number;
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
  kind: productListing.kind,
  hex: productListing.hex,
  finish: productListing.finish,
  hue: productListing.hue,
  saturation: productListing.saturation,
  lightness: productListing.lightness,
  durability: productListing.durability,
  arcDegrees: productListing.arcDegrees,
  direction: productListing.direction,
  temperatureKelvin: productListing.temperatureKelvin,
  reachCentimeters: productListing.reachCentimeters,
  coverageSquareCentimeters: productListing.coverageSquareCentimeters,
  grainMicrometers: productListing.grainMicrometers,
  torqueMillinewtonMeters: productListing.torqueMillinewtonMeters,
  backlashMicrometers: productListing.backlashMicrometers,
  weightGrams: productListing.weightGrams,
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
  spec: ProductSpec,
  primaryImage: Option<ProductImage>,
): ProductSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  spec,
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

      const tagScope: SQL = Option.match<SQL, SQL>({
        onSome: (condition) => condition,
        onNone: () => sql`TRUE`,
      })(whereExcept("tag"));

      const [kindRows, tagRows, brandRows, finishRows, summaryRows] = await Promise.all([
        scoped(
          db
            .select({ value: productListing.kind, total: count() })
            .from(productListing)
            .$dynamic(),
          whereExcept("kind"),
        ).groupBy(productListing.kind),

        /**
         * Every tag, parents included, each counted over its whole subtree.
         *
         * `closure` pairs each category with itself and all its descendants,
         * so joining through it attributes a color filed under "Gold" to
         * "Yellow" as well. `ranked` starts one level below the roots — a root
         * is a category, not a tag — and carries the root's position down the
         * tree, which is what keeps branches together in the output instead of
         * interleaving them by their within-parent index.
         *
         * The parent join skips roots too, so the outermost tag reports no
         * parent and a chain walked from a leaf stops at the category boundary
         * rather than ending on a bucket that is not in this list.
         */
        db.execute<{
          value: string;
          label: string;
          parent_slug: string | null;
          depth: number;
          kind: ProductKind;
          total: number;
        }>(sql`
          WITH RECURSIVE closure AS (
            SELECT id AS ancestor, id AS descendant FROM category
            UNION ALL
            SELECT c.ancestor, child.id
            FROM closure c
            JOIN category child ON child.parent_id = c.descendant
          ),
          ranked AS (
            SELECT c.id, c.slug, c.name, c.parent_id, c.kind, 0 AS depth,
                   root.position AS root_position, c.position AS own_position
            FROM category c
            JOIN category root ON root.id = c.parent_id AND root.parent_id IS NULL
            UNION ALL
            SELECT child.id, child.slug, child.name, child.parent_id, child.kind,
                   r.depth + 1, r.root_position, child.position
            FROM ranked r
            JOIN category child ON child.parent_id = r.id
          )
          SELECT r.slug AS value,
                 r.name AS label,
                 parent.slug AS parent_slug,
                 r.depth::int AS depth,
                 r.kind AS kind,
                 count(${productListing.id})::int AS total
          FROM ranked r
          JOIN closure cl ON cl.ancestor = r.id
          LEFT JOIN category parent
            ON parent.id = r.parent_id AND parent.parent_id IS NOT NULL
          -- Deliberately not aliased: the scope condition below is built by the
          -- same condition builder the main query uses, so it names the view in
          -- full. An alias here would leave those references dangling.
          LEFT JOIN ${productListing}
            ON ${productListing.categoryId} = cl.descendant AND ${tagScope}
          GROUP BY r.id, r.slug, r.name, r.depth, r.kind, r.root_position, r.own_position, parent.slug
          ORDER BY r.root_position, r.depth, r.own_position, r.name
        `),

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
            .select({ value: productListing.finish, total: count() })
            .from(productListing)
            .$dynamic(),
          whereExcept("finish"),
        )
          .groupBy(productListing.finish)
          .orderBy(desc(count())),

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

      // Same for finishes and categories: the universe is the enum, not
      // whatever matched.
      const finishCounts = new Map(
        finishRows.map((row) => [row.value, Number(row.total)]),
      );

      const kindCounts = new Map(
        kindRows.map((row) => [row.value, Number(row.total)]),
      );

      return {
        categories: PRODUCT_KINDS.map((kind) => ({
          value: kind,
          label: KIND_LABELS[kind],
          count: kindCounts.get(kind) ?? 0,
        })),
        tags: [...tagRows].map((row) => ({
          value: row.value,
          label: row.label,
          parentSlug: Option.fromNullable(row.parent_slug),
          depth: Number(row.depth),
          kind: row.kind,
          count: Number(row.total),
        })),
        brands: brandRows.map((row) => ({
          value: row.value,
          label: row.label,
          count: Number(row.total),
        })),
        finishes: FINISHES.map((finish) => ({
          value: finish,
          label: finishLabel(finish),
          count: finishCounts.get(finish) ?? 0,
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

      const [imageRows, reviewRows, tagRows] = await Promise.all([
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
        /*
         * The tag chain, outermost first — an acid is tagged yellow, then acid.
         *
         * The grid derives this on the client because a search response already
         * carries the whole taxonomy in its facets. One product on its own
         * carries no tree, so the walk happens here instead.
         *
         * `parent_id IS NOT NULL` drops the root, which is the product's
         * category rather than one of its tags — `spec.kind` already says which
         * shelf this came off, and repeating it as a tag would make every
         * color's first chip say "Colors".
         */
        db.execute<{ slug: string; name: string }>(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, slug, name, 0 AS depth
            FROM category WHERE slug = ${row.categorySlug}
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.slug, parent.name, ancestors.depth + 1
            FROM category parent JOIN ancestors ON parent.id = ancestors.parent_id
          )
          SELECT slug, name FROM ancestors
          WHERE parent_id IS NOT NULL
          ORDER BY depth DESC
        `),
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

      const tags: readonly CategoryRef[] = tagRows.map((tag) => ({
        slug: tag.slug,
        name: tag.name,
      }));

      const detail: ProductDetail = {
        ...toSummary(row, spec.value, Option.fromNullable(images[0])),
        description: row.description,
        tags,
        measurements: measurements.value,
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
