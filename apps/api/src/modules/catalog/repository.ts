/**
 * Every database statement the catalog makes. The categories are counted
 * over the whole shop; every other facet is counted against the products
 * that match every other active filter, so a choice within one facet never
 * hides its siblings.
 */

import type {
  CategorySummary,
  FacetBucket,
  HomeView,
  ImageId,
  ProductDetail,
  ProductFacets,
  ProductId,
  ProductQuery,
  ProductSearchResult,
  ProductSummary,
  PropertyFacet,
  Slug,
  Suggestion,
} from "@prism/shared"
import { Dimensions, Rating, Weight } from "@prism/shared"
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lte, max, min, not, sql, type SQL } from "drizzle-orm"
import type { Database } from "../../db/client.ts"
import { brands, categories, productImages, productProperties, products } from "../../db/schema.ts"
import type { Clock } from "../../platform/clock.ts"
import type { VariantSource } from "../../platform/image-store.ts"
import { ProductSearch, type LiftedFacet, type TextMatch } from "./search.ts"
import { ImageRows, type ImageRow } from "./images.ts"

/** Every read the catalog makes. */
export type CatalogRepository = Readonly<{
  search: (query: ProductQuery) => Promise<ProductSearchResult>
  /**
   * At most `limit` products whose names hold `text`, those starting with it
   * first; when no name holds it, those whose names resemble it, as the
   * search's similar match finds them.
   */
  suggest: (text: string, limit: number) => Promise<readonly Suggestion[]>
  findBySlug: (slug: Slug) => Promise<ProductDetail | undefined>
  /**
   * In-stock products outside `productIds`: those sharing a category with
   * them first, then the rest, each group best rated first.
   */
  related: (productIds: readonly ProductId[], limit: number) => Promise<readonly ProductSummary[]>
  /** The home page's rows of products; its categories come from `categories`. */
  home: () => Promise<HomeView>
  /** Every category with its product count and a picture, by name. */
  categories: () => Promise<readonly CategorySummary[]>
  /** Up to `limit` other products from the category of the product with `slug`: in stock first, then best rated. */
  sameCategory: (slug: Slug, limit: number) => Promise<readonly ProductSummary[]>
  /** How many products have `atMost` or fewer in stock. */
  countLowStock: (atMost: number) => Promise<number>
  /** Up to `limit` pictures without their smaller copies yet, leaving out `skipped`. */
  imagesWithoutVariants: (limit: number, skipped: ReadonlySet<ImageId>) => Promise<readonly VariantSource[]>
  /** Records a picture's size, which marks its smaller copies as made. */
  recordImageSize: (id: ImageId, size: Readonly<{ width: number; height: number }>) => Promise<void>
}>

export const CatalogRepository = {
  /** How many products each row of the home page shows. */
  HOME_ROW: 8,
  /** How long a listing's facets are kept, which is the most its counts may lag its results. */
  FACET_TTL_MS: 5_000,
  /** The most filter sets whose facets are kept at once; the oldest goes first. */
  FACET_ENTRIES: 500,

  /** Where a stored image file is served from. */
  imageUrl: (file: string): string => `/media/${file}`,

  create: (db: Database, clock: Clock): CatalogRepository => {
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
      images: sql<ImageRow[]>`COALESCE(
        (SELECT json_agg(${ImageRows.json("i")} ORDER BY i.position)
         FROM product_image i WHERE i.product_id = ${products.id}),
        '[]'::json
      )`,
      average: products.ratingAverage,
      count: products.ratingCount,
    }

    type SummaryRow = Readonly<{
      id: ProductId
      slug: Slug
      name: string
      priceCents: number
      stock: number
      categorySlug: Slug
      categoryName: string
      brandSlug: Slug
      brandName: string
      images: readonly ImageRow[]
      average: number
      count: number
    }>

    const toSummary = (row: SummaryRow): ProductSummary => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      priceCents: row.priceCents,
      stock: row.stock,
      category: { slug: row.categorySlug, name: row.categoryName },
      brand: { slug: row.brandSlug, name: row.brandName },
      images: row.images.map(ImageRows.view),
      rating: Rating.of(row.average, row.count),
    })

    const conditions = (query: ProductQuery, lifted: LiftedFacet, match: TextMatch) =>
      ProductSearch.where(ProductSearch.conditions(query, lifted, match))

    /** The shelf a facet lists its values over. */
    const shelf = (query: ProductQuery, match: TextMatch) => ProductSearch.where(ProductSearch.shelf(query, match))

    /** How many shelf rows also pass the rail's other filters. */
    const counted = (query: ProductQuery, lifted: LiftedFacet) =>
      sql<number>`count(*) filter (where ${ProductSearch.filter(ProductSearch.narrowing(query, lifted))})`.mapWith(Number)

    /** Every brand on the shelf, counted under the rail's other filters. */
    const brandsOf = async (query: ProductQuery, match: TextMatch): Promise<readonly FacetBucket[]> =>
      db
        .select({ value: brands.slug, label: brands.name, count: counted(query, "brand") })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(shelf(query, match))
        .groupBy(brands.slug, brands.name)
        .orderBy(asc(brands.name))

    const priceOf = async (query: ProductQuery, match: TextMatch) => {
      const [row] = await db
        .select({ min: min(products.priceCents), max: max(products.priceCents) })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(shelf(query, match))

      return { minCents: row?.min ?? 0, maxCents: row?.max ?? 0 }
    }

    const ratingsOf = async (query: ProductQuery, match: TextMatch): Promise<readonly FacetBucket[]> => {
      const rows = await db
        .select({ average: summaryColumns.average, matching: counted(query, "rating") })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(shelf(query, match))
        .groupBy(products.ratingAverage)

      // Cumulative: a product rated 4.5 counts toward "4 stars & up" and below.
      return ProductSearch.RATING_THRESHOLDS.map((threshold) => ({
        value: String(threshold),
        label: ProductSearch.ratingLabel(threshold),
        count: rows.reduce((sum, row) => (ProductSearch.isShownAtLeast(row.average, threshold) ? sum + row.matching : sum), 0),
      }))
    }

    const propertiesOf = async (query: ProductQuery, match: TextMatch): Promise<readonly PropertyFacet[]> => {
      const rows = await db
        .select({ name: productProperties.name, value: productProperties.value, count: counted(query, "property") })
        .from(productProperties)
        .innerJoin(products, eq(productProperties.productId, products.id))
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(shelf(query, match))
        .groupBy(productProperties.name, productProperties.value)
        .orderBy(asc(productProperties.name), asc(productProperties.value))

      const facets: PropertyFacet[] = []

      for (const row of rows) {
        const bucket = { value: row.value, label: row.value, count: row.count }
        const last = facets[facets.length - 1]

        if (last !== undefined && last.name === row.name) {
          facets[facets.length - 1] = { name: last.name, buckets: [...last.buckets, bucket] }
        } else {
          facets.push({ name: row.name, buckets: [bucket] })
        }
      }

      return facets
    }

    /** Facets by the filters and text match that decide them; a page, a page size and a sort change nothing in them. */
    const keptFacets = new Map<string, Readonly<{ until: number; facets: ProductFacets }>>()

    const facetsOf = async (query: ProductQuery, match: TextMatch): Promise<ProductFacets> => {
      const key = JSON.stringify([
        query.text,
        query.category,
        query.brands,
        query.priceMinCents,
        query.priceMaxCents,
        query.minRating,
        query.properties,
        match,
      ])
      const now = clock.now().getTime()
      const kept = keptFacets.get(key)
      if (kept !== undefined && kept.until > now) return kept.facets

      const [brandBuckets, price, ratings, properties] = await Promise.all([
        brandsOf(query, match),
        priceOf(query, match),
        ratingsOf(query, match),
        propertiesOf(query, match),
      ])
      const facets: ProductFacets = { brands: brandBuckets, ratings, price, properties }

      // A Map iterates in insertion order, so the first key is the oldest entry.
      keptFacets.delete(key)
      const oldest = keptFacets.keys().next()
      if (keptFacets.size >= CatalogRepository.FACET_ENTRIES && oldest.done !== true) keptFacets.delete(oldest.value)
      keptFacets.set(key, { until: now + CatalogRepository.FACET_TTL_MS, facets })

      return facets
    }

    /** How many products match `query`, whatever page it asks for. */
    const countOf = async (query: ProductQuery, match: TextMatch): Promise<number> => {
      const [row] = await db
        .select({ total: count() })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(conditions(query, "none", match))

      return row?.total ?? 0
    }

    /** One page of products matching `query`, with its facets, matching the text as `match` says. */
    const searchWith = async (query: ProductQuery, match: TextMatch): Promise<Omit<ProductSearchResult, "matched">> => {
      const [rows, facets] = await Promise.all([
        db
          .select({ ...summaryColumns, total: sql<number>`(count(*) OVER ())::int` })
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(conditions(query, "none", match))
          .orderBy(...ProductSearch.orderBy(query, match))
          .limit(query.perPage)
          .offset(ProductSearch.offset(query)),
        facetsOf(query, match),
      ])

      // A page past the end has no row to carry the count, so it is counted on its own.
      const total = rows[0]?.total ?? (query.page > 1 ? await countOf(query, match) : 0)

      return {
        items: rows.map(toSummary),
        facets,
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: ProductSearch.totalPages(total, query.perPage),
      }
    }

    /** Products as cards, in the order and number given. */
    const summaries = async (where: SQL | undefined, order: readonly SQL[], limit: number): Promise<readonly ProductSummary[]> =>
      (
        await db
          .select(summaryColumns)
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(where)
          .orderBy(...order)
          .limit(limit)
      ).map(toSummary)

    /** Products as the quick search offers them, in the order and number given. */
    const suggestions = async (where: SQL, order: readonly SQL[], limit: number): Promise<readonly Suggestion[]> =>
      (
        await db
          .select({
            slug: products.slug,
            name: products.name,
            priceCents: products.priceCents,
            // The table and a literal column: drizzle renders a bare column in a single-table select.
            image: sql<ImageRow | null>`(
              SELECT ${ImageRows.json("i")} FROM product_image i WHERE i.product_id = ${products}."id" ORDER BY i.position LIMIT 1
            )`,
          })
          .from(products)
          .where(where)
          .orderBy(...order)
          .limit(limit)
      ).map((row) => ({
        slug: row.slug,
        name: row.name,
        priceCents: row.priceCents,
        ...(row.image === null ? {} : { image: ImageRows.view(row.image) }),
      }))

    const categorySummaries = async (): Promise<readonly CategorySummary[]> => {
      const rows = await db
        .select({
          slug: categories.slug,
          name: categories.name,
          description: categories.description,
          productCount: sql<number>`(SELECT count(*)::int FROM product p WHERE p.category_id = ${categories}."id")`,
          // The first picture of the first product on the shelf that has one, read off product_category_shelf_idx.
          image: sql<ImageRow | null>`(
            SELECT ${ImageRows.json("i")} FROM product_image i
            WHERE i.product_id = (
              SELECT p.id FROM product p
              WHERE p.category_id = ${categories}."id" AND EXISTS (SELECT 1 FROM product_image x WHERE x.product_id = p.id)
              ORDER BY p.featured_at DESC NULLS LAST, p.name LIMIT 1
            )
            ORDER BY i.position LIMIT 1
          )`,
        })
        .from(categories)
        .orderBy(asc(categories.name))

      return rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        ...(row.description === null ? {} : { description: row.description }),
        productCount: row.productCount,
        ...(row.image === null ? {} : { image: ImageRows.view(row.image) }),
      }))
    }

    return {
      search: async (query) => {
        const exact = await searchWith(query, "exact")
        if (exact.total > 0 || query.text === undefined) return { matched: "exact", ...exact }

        // Nothing matched as typed: names that resemble the text catch a misspelling.
        const similar = await searchWith(query, "similar")
        return similar.total > 0 ? { matched: "similar", ...similar } : { matched: "exact", ...exact }
      },

      suggest: async (text, limit) => {
        const named = await suggestions(ilike(products.name, ProductSearch.likePattern(text)), ProductSearch.suggestionOrder(text), limit)
        if (named.length > 0) return named

        // No name holds the text as typed: names that resemble it catch a misspelling, as the results page's fallback does.
        return suggestions(ProductSearch.textCondition(text, "similar"), ProductSearch.similarityOrder(text), limit)
      },

      home: async () => {
        const [featured, topRated, newest] = await Promise.all([
          summaries(isNotNull(products.featuredAt), [desc(products.featuredAt), asc(products.slug)], CatalogRepository.HOME_ROW),
          // Three reviews at least, so one five-star review does not top the shop.
          summaries(
            gte(products.ratingCount, 3),
            [desc(summaryColumns.average), desc(summaryColumns.count), asc(products.slug)],
            CatalogRepository.HOME_ROW,
          ),
          summaries(undefined, [desc(products.createdAt), asc(products.slug)], CatalogRepository.HOME_ROW),
        ])

        return { featured, topRated, newest }
      },

      categories: categorySummaries,

      sameCategory: async (slug, limit) =>
        summaries(
          and(
            sql`${products.categoryId} = (SELECT own.category_id FROM product own WHERE own.slug = ${slug})`,
            sql`${products.slug} <> ${slug}`,
          ),
          [desc(gt(products.stock, 0)), desc(summaryColumns.average), desc(summaryColumns.count), asc(products.slug)],
          limit,
        ),

      related: async (productIds, limit) => {
        const listed = sql.join(
          productIds.map((id) => sql`${id}`),
          sql`, `,
        )
        // Postgres refuses a constant in ORDER BY, so an empty cart leaves the term out.
        const byCategory =
          productIds.length === 0
            ? []
            : [desc(sql`${products.categoryId} IN (SELECT listed.category_id FROM product listed WHERE listed.id IN (${listed}))`)]

        const rows = await db
          .select(summaryColumns)
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(productIds.length === 0 ? gt(products.stock, 0) : and(gt(products.stock, 0), not(inArray(products.id, [...productIds]))))
          .orderBy(...byCategory, desc(summaryColumns.average), desc(summaryColumns.count), asc(products.name))
          .limit(limit)

        return rows.map(toSummary)
      },

      imagesWithoutVariants: async (limit, skipped) =>
        db
          .select({ id: productImages.id, file: productImages.file, isPixelArt: productImages.isPixelArt })
          .from(productImages)
          .where(and(isNull(productImages.width), skipped.size === 0 ? undefined : not(inArray(productImages.id, [...skipped]))))
          .orderBy(asc(productImages.id))
          .limit(limit),

      recordImageSize: async (id, size) => {
        await db.update(productImages).set({ width: size.width, height: size.height }).where(eq(productImages.id, id))
      },

      countLowStock: async (atMost) => {
        const [row] = await db.select({ total: count() }).from(products).where(lte(products.stock, atMost))
        return row?.total ?? 0
      },

      findBySlug: async (slug) => {
        const [row] = await db
          .select({
            ...summaryColumns,
            description: products.description,
            weightGrams: products.weightGrams,
            widthMm: products.widthMm,
            heightMm: products.heightMm,
            depthMm: products.depthMm,
            isNameShared: sql<boolean>`EXISTS (
              SELECT 1 FROM product namesake
              WHERE namesake.category_id = ${products.categoryId} AND lower(namesake.name) = lower(${products.name}) AND namesake.id <> ${products.id}
            )`,
          })
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(eq(products.slug, slug))
          .limit(1)

        if (row === undefined) return undefined

        const properties = await db.query.productProperties.findMany({
          columns: { name: true, value: true },
          where: eq(productProperties.productId, row.id),
          orderBy: asc(productProperties.name),
        })

        return {
          ...toSummary(row),
          description: row.description,
          properties,
          isNameShared: row.isNameShared,
          weight: Weight.fromGrams(row.weightGrams),
          dimensions: Dimensions.fromMillimeters({
            width: row.widthMm,
            height: row.heightMm,
            depth: row.depthMm,
          }),
        }
      },
    }
  },
} as const
