/**
 * The catalog wire contract, in two halves.
 *
 * `productQueryParamsSchema` parses the raw query string, where an absent
 * filter really is `undefined`. `toProductQuery` then lifts that into the
 * domain shape, where absence is an `Option` and nothing downstream has to
 * think about `undefined` again. Same boundary discipline the repository
 * layer applies to nullable columns.
 */

import { z } from "zod";
import { Option } from "../fp/option.ts";
import type { Measurements } from "../domain/units.ts";

export const PRODUCT_SORTS = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const FINISHES = ["matte", "gloss", "iridescent", "fluorescent"] as const;
export type Finish = (typeof FINISHES)[number];

/**
 * The three things the shop sells, and the discriminant of every product.
 *
 * A color is a color. A finisher puts a finish back onto one. A shifter turns
 * one around the wheel. They share a price, a foundry and a rating, and share
 * almost nothing else — which is why a product is a sum type here rather than
 * one wide record with two thirds of its fields blank.
 *
 * The slug of each top-level category is exactly this string, so a category
 * filter needs no lookup to become a `WHERE kind = …`.
 */
export const PRODUCT_KINDS = ["color", "finisher", "shifter"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Which way round the wheel a shifter turns. */
export const SHIFT_DIRECTIONS = ["cw", "ccw"] as const;
export type ShiftDirection = (typeof SHIFT_DIRECTIONS)[number];

export const HUE_BOUNDS = { min: 0, max: 360 } as const;
/** A shifter that turned 0° would not be a shifter. */
export const ARC_BOUNDS = { min: 1, max: 360 } as const;
export const SATURATION_BOUNDS = { min: 0, max: 100 } as const;
export const LIGHTNESS_BOUNDS = { min: 0, max: 100 } as const;
export const PRICE_BOUNDS = { min: 0, max: 100_000_000 } as const;

export const MAX_PER_PAGE = 60;

/**
 * Three rows of four on a desktop grid. The results column — count, grid and
 * pagination controls together — then fits inside the height of the filter
 * rail beside it, so narrowing 240 colors down to 3 cannot change the height
 * of the document or move the scroll position under the pointer.
 */
export const DEFAULT_PER_PAGE = 12;

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
  /** The category, which is the kind. One at a time — a product is one thing. */
  category: z.enum(PRODUCT_KINDS).optional(),
  /** A node of the taxonomy beneath a category; matches its whole subtree. */
  tag: slugSchema.optional(),
  brands: commaSeparated.pipe(z.array(slugSchema).max(20)),
  finishes: commaSeparated.pipe(z.array(z.enum(FINISHES)).max(FINISHES.length)),
  direction: z.enum(SHIFT_DIRECTIONS).optional(),
  arcMin: z.coerce.number().int().min(ARC_BOUNDS.min).max(ARC_BOUNDS.max).optional(),
  arcMax: z.coerce.number().int().min(ARC_BOUNDS.min).max(ARC_BOUNDS.max).optional(),
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
  lightnessMin: z.coerce
    .number()
    .int()
    .min(LIGHTNESS_BOUNDS.min)
    .max(LIGHTNESS_BOUNDS.max)
    .optional(),
  lightnessMax: z.coerce
    .number()
    .int()
    .min(LIGHTNESS_BOUNDS.min)
    .max(LIGHTNESS_BOUNDS.max)
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
  /** The category. Absent means all three at once. */
  kind: Option<ProductKind>;
  tagSlug: Option<string>;
  brandSlugs: readonly string[];
  /** Colors have one; so does a finisher, being the finish it puts back. */
  finishes: readonly Finish[];
  price: Option<NumericRange>;
  minRating: Option<number>;
  /** `min > max` is a wrap-around arc through 0°, which is where the reds live. */
  hue: Option<NumericRange>;
  saturation: Option<NumericRange>;
  lightness: Option<NumericRange>;
  direction: Option<ShiftDirection>;
  arc: Option<NumericRange>;
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
  kind: Option.fromNullable(params.category),
  tagSlug: Option.fromNullable(params.tag),
  brandSlugs: params.brands,
  finishes: params.finishes,
  price: Option.map(ordered)(rangeOf(params.priceMin, params.priceMax, PRICE_BOUNDS)),
  minRating: Option.fromNullable(params.minRating),
  // Hue is deliberately not ordered — see the wrap-around note above.
  hue: rangeOf(params.hueMin, params.hueMax, HUE_BOUNDS),
  saturation: Option.map(ordered)(
    rangeOf(params.saturationMin, params.saturationMax, SATURATION_BOUNDS),
  ),
  lightness: Option.map(ordered)(
    rangeOf(params.lightnessMin, params.lightnessMax, LIGHTNESS_BOUNDS),
  ),
  direction: Option.fromNullable(params.direction),
  // An arc is a span, not a position on a circle, so it orders like price.
  arc: Option.map(ordered)(rangeOf(params.arcMin, params.arcMax, ARC_BOUNDS)),
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

/**
 * What a color is: one stored hex and one stored finish. The three channels
 * come back from the database derived, never written.
 */
export type ColorSpec = Readonly<{
  kind: "color";
  hex: string;
  finish: Finish;
  hue: number;
  saturation: number;
  lightness: number;
}>;

/** What a finisher is: the finish it puts back, and how many colors' worth. */
export type FinisherSpec = Readonly<{
  kind: "finisher";
  finish: Finish;
  durability: number;
}>;

/** What a shifter is: which way round the wheel, and how far. */
export type ShifterSpec = Readonly<{
  kind: "shifter";
  direction: ShiftDirection;
  arcDegrees: number;
}>;

/**
 * The part of a product that differs by category.
 *
 * Everything outside this is common to all three, so nothing here is ever
 * absent-but-typed: a shifter has no `hex` field at all, rather than a `hex`
 * that is null.
 */
export type ProductSpec = ColorSpec | FinisherSpec | ShifterSpec;

export type ProductSummary = Readonly<{
  id: string;
  slug: string;
  name: string;
  spec: ProductSpec;
  priceCents: number;
  stockQuantity: number;
  brand: BrandRef;
  /** The node it is filed under, which may be a tag beneath its category. */
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
    /**
     * The tag chain, outermost first: an acid is tagged yellow, then acid.
     * The category itself is not in it — that is what `spec.kind` says.
     *
     * The grid works this out on the client — a search response already carries
     * the whole taxonomy in its facets — but one product on its own has no
     * tree to walk, so its detail carries the answer.
     */
    tags: readonly CategoryRef[];
    /** Metric is stored, imperial is derived — see `units.ts`. */
    measurements: Measurements;
    images: readonly ProductImage[];
    reviews: readonly ProductReview[];
  }>;

export type FacetBucket = Readonly<{
  value: string;
  label: string;
  count: number;
}>;

/**
 * Tags are a tree, so their facet carries enough shape to be rendered as one.
 * A parent is selectable in its own right — picking "Yellow" means every color
 * beneath it — and its count is its whole subtree, which is why the numbers on
 * a parent and its children do not sum to the total.
 */
export type TagFacetBucket = FacetBucket &
  Readonly<{
    parentSlug: Option<string>;
    /** 0 for a tag directly under a category, 1 for its children, and so on. */
    depth: number;
    /** Which category's taxonomy this tag belongs to. */
    kind: ProductKind;
  }>;

export type ProductFacets = Readonly<{
  /** The three categories, always all three, counted independently. */
  categories: readonly FacetBucket[];
  tags: readonly TagFacetBucket[];
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

/** Plural, because a category names a shelf rather than a product. */
export const KIND_LABELS: Record<ProductKind, string> = {
  color: "Colors",
  finisher: "Finishers",
  shifter: "Shifters",
};

export const DIRECTION_LABELS: Record<ShiftDirection, string> = {
  cw: "Clockwise",
  ccw: "Counter-clockwise",
};

/** Compact enough to sit on a card: red → yellow is ↻, red → violet is ↺. */
export const DIRECTION_SYMBOLS: Record<ShiftDirection, string> = {
  cw: "↻",
  ccw: "↺",
};

export type Suggestion = Readonly<{
  kind: "product" | "brand" | "category";
  label: string;
  slug: string;
  /** Products carry their swatch so the dropdown can show it. */
  hex: Option<string>;
}>;
