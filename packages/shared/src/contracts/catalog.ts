/**
 * The catalogue wire contract, in two halves.
 *
 * `productQueryParamsSchema` parses the raw query string, where an absent
 * filter really is `undefined`. `toProductQuery` then lifts that into the
 * domain shape, where absence is an `Option` and nothing downstream has to
 * think about `undefined` again. Same boundary discipline the repository
 * layer applies to nullable columns.
 */

import { z } from "zod";
import { Option } from "../option.ts";
import type { Measurements } from "../units.ts";

export const PRODUCT_SORTS = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const FINISHES = ["matte", "gloss", "iridescent", "fluorescent"] as const;
export type Finish = (typeof FINISHES)[number];

export const HUE_BOUNDS = { min: 0, max: 360 } as const;
export const SATURATION_BOUNDS = { min: 0, max: 100 } as const;
export const PRICE_BOUNDS = { min: 0, max: 100_000_000 } as const;

export const MAX_PER_PAGE = 60;
export const DEFAULT_PER_PAGE = 24;

/**
 * Multi-value filters travel comma-separated (`brands=chroma-labs,cyan-and-sons`)
 * rather than as repeated keys. One parse path instead of "string or array of
 * string", and it keeps the URL short enough to share.
 */
const commaSeparated = z
  .string()
  .trim()
  .default("")
  .transform((raw) =>
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, "Not a valid slug.")
  .max(120);

/**
 * Free text, but not *any* text.
 *
 * Postgres `text` cannot hold a NUL byte, so passing one through as a bound
 * parameter makes the driver raise — which surfaces as a 500 for what is
 * really a malformed request. Control characters carry no search meaning
 * either, so they are refused at the edge where the answer is a clean 422.
 */
const searchTermSchema = z
  .string()
  .trim()
  .max(120)
  .refine((term) => !/[\u0000-\u001f\u007f]/.test(term), "Contains invalid characters.");

export const productQueryParamsSchema = z.object({
  q: searchTermSchema.optional(),
  category: slugSchema.optional(),
  brands: commaSeparated.pipe(z.array(slugSchema).max(20)),
  finishes: commaSeparated.pipe(z.array(z.enum(FINISHES)).max(FINISHES.length)),
  priceMin: z.coerce.number().int().min(PRICE_BOUNDS.min).max(PRICE_BOUNDS.max).optional(),
  priceMax: z.coerce.number().int().min(PRICE_BOUNDS.min).max(PRICE_BOUNDS.max).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  hueMin: z.coerce.number().int().min(HUE_BOUNDS.min).max(HUE_BOUNDS.max).optional(),
  hueMax: z.coerce.number().int().min(HUE_BOUNDS.min).max(HUE_BOUNDS.max).optional(),
  saturationMin: z.coerce
    .number()
    .int()
    .min(SATURATION_BOUNDS.min)
    .max(SATURATION_BOUNDS.max)
    .optional(),
  saturationMax: z.coerce
    .number()
    .int()
    .min(SATURATION_BOUNDS.min)
    .max(SATURATION_BOUNDS.max)
    .optional(),
  sort: z.enum(PRODUCT_SORTS).default("relevance"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
});

export type ProductQueryParams = z.infer<typeof productQueryParamsSchema>;

export const suggestQueryParamsSchema = z.object({
  q: searchTermSchema.pipe(z.string().min(1).max(60)),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type SuggestQueryParams = z.infer<typeof suggestQueryParamsSchema>;

export type NumericRange = Readonly<{ min: number; max: number }>;

export type ProductQuery = Readonly<{
  text: Option<string>;
  categorySlug: Option<string>;
  brandSlugs: readonly string[];
  finishes: readonly Finish[];
  price: Option<NumericRange>;
  minRating: Option<number>;
  /** `min > max` is a wrap-around arc through 0°, which is where the reds live. */
  hue: Option<NumericRange>;
  saturation: Option<NumericRange>;
  sort: ProductSort;
  page: number;
  perPage: number;
}>;

/** Absent on both sides means "no filter"; one side present means "open-ended". */
const rangeOf = (
  min: number | undefined,
  max: number | undefined,
  bounds: NumericRange,
): Option<NumericRange> =>
  min === undefined && max === undefined
    ? Option.none
    : Option.some({ min: min ?? bounds.min, max: max ?? bounds.max });

/** Forgiving: a slider dragged backwards is a range, not an error. */
const ordered = (range: NumericRange): NumericRange => ({
  min: Math.min(range.min, range.max),
  max: Math.max(range.min, range.max),
});

export const toProductQuery = (params: ProductQueryParams): ProductQuery => ({
  text: Option.filter<string>((text) => text.length > 0)(
    Option.fromNullable(params.q),
  ),
  categorySlug: Option.fromNullable(params.category),
  brandSlugs: params.brands,
  finishes: params.finishes,
  price: Option.map(ordered)(rangeOf(params.priceMin, params.priceMax, PRICE_BOUNDS)),
  minRating: Option.fromNullable(params.minRating),
  // Hue is deliberately not ordered — see the wrap-around note above.
  hue: rangeOf(params.hueMin, params.hueMax, HUE_BOUNDS),
  saturation: Option.map(ordered)(
    rangeOf(params.saturationMin, params.saturationMax, SATURATION_BOUNDS),
  ),
  sort: params.sort,
  page: params.page,
  perPage: params.perPage,
});

export type ProductImage = Readonly<{
  url: string;
  alt: string;
  position: number;
}>;

export type Rating = Readonly<{ average: number; count: number }>;

export type BrandRef = Readonly<{ slug: string; name: string }>;
export type CategoryRef = Readonly<{ slug: string; name: string }>;

export type ProductSummary = Readonly<{
  id: string;
  slug: string;
  name: string;
  hex: string;
  finish: Finish;
  priceCents: number;
  stockQuantity: number;
  brand: BrandRef;
  category: CategoryRef;
  rating: Rating;
  primaryImage: Option<ProductImage>;
}>;

export type ProductReview = Readonly<{
  id: string;
  rating: number;
  body: string;
  authorInitial: string;
  createdAt: string;
}>;

export type ProductDetail = ProductSummary &
  Readonly<{
    description: string;
    /** Metric is stored, imperial is derived — see `units.ts`. */
    measurements: Measurements;
    hue: number;
    saturation: number;
    lightness: number;
    images: readonly ProductImage[];
    reviews: readonly ProductReview[];
  }>;

export type FacetBucket = Readonly<{
  value: string;
  label: string;
  count: number;
}>;

export type ProductFacets = Readonly<{
  categories: readonly FacetBucket[];
  brands: readonly FacetBucket[];
  finishes: readonly FacetBucket[];
  /** "4 stars & up", "3 stars & up", … */
  ratings: readonly FacetBucket[];
  priceCents: NumericRange;
}>;

export type ProductSearchResult = Readonly<{
  items: readonly ProductSummary[];
  facets: ProductFacets;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}>;

export type CategoryNode = Readonly<{
  id: string;
  slug: string;
  name: string;
  productCount: number;
  children: readonly CategoryNode[];
}>;

export type Suggestion = Readonly<{
  kind: "product" | "brand" | "category";
  label: string;
  slug: string;
  /** Products carry their swatch so the dropdown can show it. */
  hex: Option<string>;
}>;
