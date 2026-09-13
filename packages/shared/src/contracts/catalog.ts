/**
 * The catalog as the API serves it and the browser reads it.
 *
 * Nothing here knows what the shop sells. A product has a category, a brand,
 * a price, stock, measurements and a bag of named properties; every filter
 * and every facet is derived from those rows at query time.
 */

import { z } from "zod";

/** A URL-safe identifier for a product, category or brand. */
export const Slug = {
  schema: z.string().trim().max(120).regex(/^[a-z0-9-]+$/, "Not a valid slug."),
} as const;

/** The orders a result list can come in. */
export type ProductSort = (typeof ProductSort.NAMES)[number];
export const ProductSort = {
  NAMES: ["relevance", "price_asc", "price_desc", "rating"] as const,
  schema: z.enum(["relevance", "price_asc", "price_desc", "rating"]),
  label: {
    relevance: "Relevance",
    price_asc: "Price: low to high",
    price_desc: "Price: high to low",
    rating: "Top rated",
  } as const satisfies Record<"relevance" | "price_asc" | "price_desc" | "rating", string>,
} as const;

/** Free text as a person typed it, trimmed and without control characters. */
export const SearchText = {
  MAX_LENGTH: 120,
  // eslint-disable-next-line no-control-regex
  CONTROL: /[\x00-\x1f\x7f]/,
  schema: z
    .string()
    .trim()
    .max(120)
    .refine(
      (text: string): boolean => !SearchText.CONTROL.test(text),
      "Control characters are not allowed.",
    ),
} as const;

/** A key repeated in a query string arrives as an array; a single one as a string. */
export const MultiValue = {
  schema: z
    .union([z.string().max(120), z.array(z.string().max(120)).max(50)])
    .transform((value) => (typeof value === "string" ? [value] : value)),
  /** The same, where every value has to be a slug. */
  slugs: z
    .union([Slug.schema, z.array(Slug.schema).max(50)])
    .transform((value) => (typeof value === "string" ? [value] : value)),
} as const;

/** The values one named property is filtered to; any of them matches. */
export type PropertyFilter = Readonly<{ name: string; values: readonly string[] }>;

/**
 * A search as the service runs it: optional filters, one sort and one page.
 * Values within one property or brand list are alternatives; different
 * filters all have to hold.
 */
export type ProductQuery = Readonly<{
  text?: string;
  category?: string;
  brands: readonly string[];
  priceMinCents?: number;
  priceMaxCents?: number;
  minRating?: number;
  properties: readonly PropertyFilter[];
  sort: ProductSort;
  page: number;
  perPage: number;
}>;

/**
 * The query string of `GET /products`, as it arrives: every recognized key,
 * plus any `p.<name>` key for a filter on the property of that name.
 */
export type ProductQueryParams = z.infer<typeof ProductQueryParams.schema>;
export const ProductQueryParams = {
  schema: z
    .object({
      q: SearchText.schema.optional(),
      category: Slug.schema.optional(),
      brand: MultiValue.slugs.optional(),
      priceMin: z.coerce.number().int().min(0).optional(),
      priceMax: z.coerce.number().int().min(0).optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      sort: ProductSort.schema.default("relevance"),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      perPage: z.coerce.number().int().min(1).max(60).default(12),
    })
    .catchall(MultiValue.schema),
} as const;

export const ProductQuery = {
  DEFAULT_PER_PAGE: 12,
  MAX_PER_PAGE: 60,
  /** Query keys that start with this filter on a product property of that name. */
  PROPERTY_PREFIX: "p.",

  /** The query a parsed query string asks for. Empty text and empty lists count as absent. */
  fromParams: (params: ProductQueryParams): ProductQuery => {
    const properties: PropertyFilter[] = [];

    for (const [key, value] of Object.entries(params)) {
      if (!key.startsWith(ProductQuery.PROPERTY_PREFIX) || !Array.isArray(value)) continue;

      const name = key.slice(ProductQuery.PROPERTY_PREFIX.length);
      const values = value.filter((item) => item.length > 0);

      if (name.length > 0 && values.length > 0) properties.push({ name, values });
    }

    const brands = (params.brand ?? []).filter((slug) => slug.length > 0);

    return {
      ...(params.q !== undefined && params.q.length > 0 ? { text: params.q } : {}),
      ...(params.category !== undefined ? { category: params.category } : {}),
      brands,
      ...(params.priceMin !== undefined ? { priceMinCents: params.priceMin } : {}),
      ...(params.priceMax !== undefined ? { priceMaxCents: params.priceMax } : {}),
      ...(params.rating !== undefined ? { minRating: params.rating } : {}),
      properties,
      sort: params.sort,
      page: params.page,
      perPage: params.perPage,
    };
  },
} as const;

/** The query string of `GET /products/suggest`. */
export type SuggestParams = z.infer<typeof SuggestParams.schema>;
export const SuggestParams = {
  schema: z.object({
    q: SearchText.schema.pipe(z.string().min(1).max(60)),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  }),
} as const;

/** One product a typed prefix could mean. */
export type Suggestion = Readonly<{ slug: string; name: string }>;

/** A name a product is filed under: a category or a brand. */
export type Named = Readonly<{ slug: string; name: string }>;

/** How shoppers have rated a product. `average` is 0 while `count` is 0. */
export type Rating = Readonly<{ average: number; count: number }>;

/** One picture of a product, served from `/media`. */
export type ProductImage = Readonly<{ url: string; alt: string }>;

/** A mass in both unit systems. */
export type Weight = Readonly<{ grams: number; ounces: number }>;
export const Weight = {
  GRAMS_PER_OUNCE: 28.349523125,
  fromGrams: (grams: number): Weight => ({
    grams,
    ounces: Math.round((grams / Weight.GRAMS_PER_OUNCE) * 100) / 100,
  }),
} as const;

/** Width, height and depth in one unit. */
export type Size = Readonly<{ width: number; height: number; depth: number }>;

/** A box in both unit systems. */
export type Dimensions = Readonly<{ millimeters: Size; inches: Size }>;
export const Dimensions = {
  MILLIMETERS_PER_INCH: 25.4,
  toInches: (millimeters: number): number =>
    Math.round((millimeters / Dimensions.MILLIMETERS_PER_INCH) * 100) / 100,
  fromMillimeters: (millimeters: Size): Dimensions => ({
    millimeters,
    inches: {
      width: Dimensions.toInches(millimeters.width),
      height: Dimensions.toInches(millimeters.height),
      depth: Dimensions.toInches(millimeters.depth),
    },
  }),
} as const;

/** A price in the shop's one currency, kept as whole cents. */
export const Price = {
  CURRENCY: "EUR",
  format: (cents: number): string =>
    new Intl.NumberFormat("en", { style: "currency", currency: Price.CURRENCY }).format(
      cents / 100,
    ),
} as const;

/** A product as a result list shows it. */
export type ProductSummary = Readonly<{
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  stock: number;
  category: Named;
  brand: Named;
  images: readonly ProductImage[];
  rating: Rating;
}>;

/** One named fact about a product, as its data carries it. */
export type ProductProperty = Readonly<{ name: string; value: string }>;

/** A product as its own page shows it. */
export type ProductDetail = ProductSummary &
  Readonly<{
    description: string;
    properties: readonly ProductProperty[];
    weight: Weight;
    dimensions: Dimensions;
  }>;

/** One selectable value of a facet and how many matching products carry it. */
export type FacetBucket = Readonly<{ value: string; label: string; count: number }>;

/** The values one product property takes across the matching products. */
export type PropertyFacet = Readonly<{ name: string; buckets: readonly FacetBucket[] }>;

/** The cheapest and dearest matching product, both 0 when nothing matches. */
export type PriceRange = Readonly<{ minCents: number; maxCents: number }>;

/**
 * Every filter a shopper can apply next. The categories count the whole
 * shop; every other facet is counted against the products that match every
 * other active filter, so a choice within one facet never hides its siblings.
 */
export type ProductFacets = Readonly<{
  categories: readonly FacetBucket[];
  brands: readonly FacetBucket[];
  /** Minimum-rating thresholds, highest first. */
  ratings: readonly FacetBucket[];
  price: PriceRange;
  properties: readonly PropertyFacet[];
}>;

/** One page of results with the facets that apply to the whole match. */
export type ProductSearchResult = Readonly<{
  items: readonly ProductSummary[];
  facets: ProductFacets;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}>;
