/**
 * Every database statement the catalog makes. The categories are counted
 * over the whole shop; every other facet is counted against the products
 * that match every other active filter, so a choice within one facet never
 * hides its siblings.
 */

import type {
  FacetBucket,
  ProductDetail,
  ProductFacets,
  ProductId,
  ProductImage,
  ProductQuery,
  ProductSearchResult,
  ProductSummary,
  PropertyFacet,
  Slug,
  Suggestion,
} from "@prism/shared";
import { Dimensions, Weight } from "@prism/shared";
import { asc, count, eq, ilike, max, min, sql } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import { brands, categories, productProperties, productReviews, products } from "../../db/schema.ts";
import { ProductSearch, type LiftedFacet } from "./search.ts";

/** Every read the catalog makes. */
export type CatalogRepository = Readonly<{
  search: (query: ProductQuery) => Promise<ProductSearchResult>;
  suggest: (text: string, limit: number) => Promise<readonly Suggestion[]>;
  findBySlug: (slug: Slug) => Promise<ProductDetail | undefined>;
}>;

export const CatalogRepository = {
  /** Where a stored image file is served from. */
  imageUrl: (file: string): string => `/media/${file}`,

  create: (db: Database): CatalogRepository => {
    // One row per reviewed product; a product without reviews joins to nothing.
    const rating = db
      .select({
        productId: productReviews.productId,
        average: sql<number>`avg(${productReviews.rating})::float`.as("average"),
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(productReviews)
      .groupBy(productReviews.productId)
      .as("rating");

    const ratingColumns = {
      average: sql`COALESCE(${rating.average}, 0)`,
      count: sql`COALESCE(${rating.count}, 0)`,
    };

    const summaryColumns = {
      id: products.id,
      slug: products.slug,
      name: products.name,
      priceCents: products.priceCents,
      stock: products.stock,
      categorySlug: categories.slug,
      categoryName: categories.name,
      brandSlug: brands.slug,
      brandName: brands.name,
      images: sql<ProductImage[]>`COALESCE(
        (SELECT json_agg(json_build_object('url', '/media/' || i.file, 'alt', i.alt) ORDER BY i.position)
         FROM product_image i WHERE i.product_id = ${products.id}),
        '[]'::json
      )`,
      average: sql<number>`COALESCE(${rating.average}, 0)`,
      count: sql<number>`COALESCE(${rating.count}, 0)`,
    };

    type SummaryRow = Readonly<{
      id: ProductId;
      slug: Slug;
      name: string;
      priceCents: number;
      stock: number;
      categorySlug: Slug;
      categoryName: string;
      brandSlug: Slug;
      brandName: string;
      images: readonly ProductImage[];
      average: number;
      count: number;
    }>;

    const toSummary = (row: SummaryRow): ProductSummary => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      priceCents: row.priceCents,
      stock: row.stock,
      category: { slug: row.categorySlug, name: row.categoryName },
      brand: { slug: row.brandSlug, name: row.brandName },
      images: row.images,
      rating: { average: Math.round(row.average * 10) / 10, count: row.count },
    });

    const conditions = (query: ProductQuery, lifted: LiftedFacet) =>
      ProductSearch.where(ProductSearch.conditions(query, ratingColumns, lifted));

    /** The shelf a facet lists its values over. */
    const shelf = (query: ProductQuery) => ProductSearch.where(ProductSearch.shelf(query));

    /** How many shelf rows also pass the rail's other filters. */
    const counted = (query: ProductQuery, lifted: LiftedFacet) =>
      sql<number>`count(*) filter (where ${ProductSearch.filter(ProductSearch.narrowing(query, ratingColumns, lifted))})`.mapWith(Number);

    /** Every category with how many products it files, whatever the query says. */
    const categoriesOf = async (): Promise<readonly FacetBucket[]> =>
      db
        .select({ value: categories.slug, label: categories.name, count: count(products.id) })
        .from(categories)
        .leftJoin(products, eq(products.categoryId, categories.id))
        .groupBy(categories.slug, categories.name)
        .orderBy(asc(categories.name));

    /** Every brand on the shelf, counted under the rail's other filters. */
    const brandsOf = async (query: ProductQuery): Promise<readonly FacetBucket[]> =>
      db
        .select({ value: brands.slug, label: brands.name, count: counted(query, "brand") })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(rating, eq(rating.productId, products.id))
        .where(shelf(query))
        .groupBy(brands.slug, brands.name)
        .orderBy(asc(brands.name));

    const priceOf = async (query: ProductQuery) => {
      const [row] = await db
        .select({ min: min(products.priceCents), max: max(products.priceCents) })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(rating, eq(rating.productId, products.id))
        .where(shelf(query));

      return { minCents: row?.min ?? 0, maxCents: row?.max ?? 0 };
    };

    const ratingsOf = async (query: ProductQuery): Promise<readonly FacetBucket[]> => {
      const rows = await db
        .select({ average: summaryColumns.average, matching: counted(query, "rating") })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(rating, eq(rating.productId, products.id))
        .where(shelf(query))
        .groupBy(rating.average);

      // Cumulative: a product rated 4.5 counts toward "4 stars & up" and below.
      return ProductSearch.RATING_THRESHOLDS.map((threshold) => ({
        value: String(threshold),
        label: ProductSearch.ratingLabel(threshold),
        count: rows.reduce((sum, row) => (row.average >= threshold ? sum + row.matching : sum), 0),
      }));
    };

    const propertiesOf = async (query: ProductQuery): Promise<readonly PropertyFacet[]> => {
      const rows = await db
        .select({ name: productProperties.name, value: productProperties.value, count: counted(query, "property") })
        .from(productProperties)
        .innerJoin(products, eq(productProperties.productId, products.id))
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(rating, eq(rating.productId, products.id))
        .where(shelf(query))
        .groupBy(productProperties.name, productProperties.value)
        .orderBy(asc(productProperties.name), asc(productProperties.value));

      const facets: PropertyFacet[] = [];

      for (const row of rows) {
        const bucket = { value: row.value, label: row.value, count: row.count };
        const last = facets[facets.length - 1];

        if (last !== undefined && last.name === row.name) {
          facets[facets.length - 1] = { name: last.name, buckets: [...last.buckets, bucket] };
        } else {
          facets.push({ name: row.name, buckets: [bucket] });
        }
      }

      return facets;
    };

    return {
      search: async (query) => {
        const [rows, categoryBuckets, brandBuckets, price, ratings, properties] = await Promise.all([
          db
            .select({ ...summaryColumns, total: sql<number>`(count(*) OVER ())::int` })
            .from(products)
            .innerJoin(categories, eq(products.categoryId, categories.id))
            .innerJoin(brands, eq(products.brandId, brands.id))
            .leftJoin(rating, eq(rating.productId, products.id))
            .where(conditions(query, "none"))
            .orderBy(...ProductSearch.orderBy(query, ratingColumns))
            .limit(query.perPage)
            .offset(ProductSearch.offset(query)),
          categoriesOf(),
          brandsOf(query),
          priceOf(query),
          ratingsOf(query),
          propertiesOf(query),
        ]);

        const total = rows[0]?.total ?? 0;
        const facets: ProductFacets = {
          categories: categoryBuckets,
          brands: brandBuckets,
          ratings,
          price,
          properties,
        };

        return {
          items: rows.map(toSummary),
          facets,
          total,
          page: query.page,
          perPage: query.perPage,
          totalPages: ProductSearch.totalPages(total, query.perPage),
        };
      },

      suggest: (text, limit) =>
        db
          .select({ slug: products.slug, name: products.name })
          .from(products)
          .where(ilike(products.name, ProductSearch.likePattern(text)))
          .orderBy(...ProductSearch.suggestionOrder(text))
          .limit(limit),

      findBySlug: async (slug) => {
        const [row] = await db
          .select({ ...summaryColumns, description: products.description })
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .leftJoin(rating, eq(rating.productId, products.id))
          .where(eq(products.slug, slug))
          .limit(1);

        if (row === undefined) return undefined;

        const [measures, properties] = await Promise.all([
          db.query.products.findFirst({
            columns: { weightGrams: true, widthMm: true, heightMm: true, depthMm: true },
            where: eq(products.id, row.id),
          }),
          db.query.productProperties.findMany({
            columns: { name: true, value: true },
            where: eq(productProperties.productId, row.id),
            orderBy: asc(productProperties.name),
          }),
        ]);

        if (measures === undefined) return undefined;

        return {
          ...toSummary(row),
          description: row.description,
          properties,
          weight: Weight.fromGrams(measures.weightGrams),
          dimensions: Dimensions.fromMillimeters({
            width: measures.widthMm,
            height: measures.heightMm,
            depth: measures.depthMm,
          }),
        };
      },
    };
  },
} as const;
