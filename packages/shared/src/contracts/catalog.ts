/**
 * The catalog wire contract, in two halves.
 *
 * `productQueryParamsSchema` parses the raw query string, where an absent
 * filter really is `undefined`. `toProductQuery` then lifts that into the
 * domain shape, where absence is an `Option` and nothing downstream has to
 * think about `undefined` again. Same boundary discipline the repository
 * layer applies to nullable columns.
 */

import { match } from "ts-pattern";
import { z } from "zod";
import { Option } from "../fp/option.ts";
import type { Measurements } from "../domain/units.ts";

/** Every order the grid can be asked for. */
export const PRODUCT_SORTS = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating",
] as const;
/** The order a search returns its results in. */
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/**
 * The three words people use for what a finish does to a surface.
 *
 * One per amount below: a grain, a coating and a glow. They name regions of
 * the space those amounts span, so they are how the catalog talks about
 * itself. Nothing is stored as one of them.
 */
export const FINISHES = ["roughness", "iridescent", "fluorescent"] as const;
/** One of the three words, as prose about a surface rather than a stored fact. */
export type Finish = (typeof FINISHES)[number];

/**
 * The three amounts a finish is made of.
 *
 * A color carries all three at once and is filtered on each independently — a
 * shopper can ask for a coated surface that also glows. A finisher is bought
 * for the one effect it produces, so its shelf is narrowed by the words first
 * and then by the amount each word names.
 */
export const FINISH_PROPERTIES = ["roughness", "coating", "emission"] as const;
/** One amount a finish is made of. */
export type FinishProperty = (typeof FINISH_PROPERTIES)[number];

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
/** Which of the three things a product is. */
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * The color families a shopper can search by.
 *
 * Each name is a landmark in RGB space, and a color belongs to whichever
 * landmark is nearest — so the set of names partitions the color cube into one
 * cell each, and no color is ever filed under a name by hand. The database
 * holds the same list inside `color_family`, which is what derives the column.
 */
export const COLOR_FAMILIES = [
  "red",
  "orange",
  "gold",
  "yellow",
  "lime",
  "green",
  "teal",
  "blue",
  "violet",
  "magenta",
  "pink",
  "brown",
  "maroon",
  "navy",
  "olive",
  "cream",
  "black",
  "gray",
  "white",
] as const;

/** The family a color falls in, which is the nearest landmark to its hex. */
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/** Which way round the wheel a shifter turns. */
export const SHIFT_DIRECTIONS = ["cw", "ccw"] as const;
/** Which way a shifter turns a color. */
export type ShiftDirection = (typeof SHIFT_DIRECTIONS)[number];

/** Hue in degrees, all the way round. */
export const HUE_BOUNDS = { min: 0, max: 360 } as const;
/** A shifter that turned 0° would not be a shifter. */
export const ARC_BOUNDS = { min: 1, max: 360 } as const;
/** Saturation as a percentage: 0 is gray, 100 is a pure hue. */
export const SATURATION_BOUNDS = { min: 0, max: 100 } as const;
/** Lightness as a percentage: 0 is black, 100 is white. */
export const LIGHTNESS_BOUNDS = { min: 0, max: 100 } as const;
/** The widest price filter the API accepts, in cents. */
export const PRICE_BOUNDS = { min: 0, max: 100_000_000 } as const;

/**
 * How rough a surface is: 5 is a mirror, 95 is chalk.
 *
 * The direction is the word's own, so a lacquered surface is a low number. It
 * never reaches either end — paint that returned everything or nothing would
 * not be paint.
 *
 * Matte and gloss are both on this axis and differ by where on it they sit.
 */
export const ROUGHNESS_BOUNDS = { min: 5, max: 95 } as const;

/**
 * Nanometers of interference coating.
 *
 * The coating is a transparent layer over the paint, and its thickness is the
 * whole of what decides its color: light returning off the top of it meets
 * light returning off the paint underneath, having traveled twice through it,
 * and the wavelengths that come back in step are the ones you see. Twice the
 * thickness is a different color, not more of the same one.
 *
 * Zero is bare paint, which is most colors. Below the minimum the layer is
 * thinner than the light it would have to bend and shows nothing at all, so
 * nothing sensible lives between zero and it, which `product_property_ranges`
 * enforces in the database. Past the maximum the orders pile up and the color
 * washes out to a pearly white.
 */
export const COATING_BOUNDS = { min: 100, max: 600 } as const;

/**
 * The roughest a surface can be and still show a coating.
 *
 * Interference happens to a reflection. A surface that scatters its reflection
 * away has none for it to happen in, so a coating over chalk is a coating
 * nobody can see. `product_coating_needs_a_reflection` enforces the same
 * number in the database.
 */
export const COATING_ROUGHNESS_CEILING = 40;

/** How hard a surface gives off its own light. Zero for most of them. */
export const EMISSION_BOUNDS = { min: 0, max: 100 } as const;

/** The largest page a client may ask for, so one request cannot pull the shelf. */
export const MAX_PER_PAGE = 60;

/**
 * Three rows of four on a desktop grid. The results column — count, grid and
 * pagination controls together — then fits inside the height of the filter
 * rail beside it, so narrowing the shelf to a handful cannot change the height
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

/** The query string of `GET /products`, where an absent filter is `undefined`. */
export const productQueryParamsSchema = z.object({
  q: searchTermSchema.optional(),
  /** The category, which is the kind. One at a time — a product is one thing. */
  category: z.enum(PRODUCT_KINDS).optional(),
  /** A color family, which only colors have. */
  family: z.enum(COLOR_FAMILIES).optional(),
  brands: commaSeparated.pipe(z.array(slugSchema).max(20)),
  /**
   * The finishes of the finishers to show, comma-separated. None is every
   * finish. Finishers only — a color carries all three amounts.
   */
  finish: commaSeparated.pipe(z.array(z.enum(FINISHES)).max(FINISHES.length)),
  roughnessMin: z.coerce
    .number()
    .int()
    .min(ROUGHNESS_BOUNDS.min)
    .max(ROUGHNESS_BOUNDS.max)
    .optional(),
  roughnessMax: z.coerce
    .number()
    .int()
    .min(ROUGHNESS_BOUNDS.min)
    .max(ROUGHNESS_BOUNDS.max)
    .optional(),
  // Zero is a legitimate floor here and not a bound of the coating's own
  // range: "no coating at all" is the commonest answer and has to be askable.
  coatingMin: z.coerce.number().int().min(0).max(COATING_BOUNDS.max).optional(),
  coatingMax: z.coerce.number().int().min(0).max(COATING_BOUNDS.max).optional(),
  emissionMin: z.coerce
    .number()
    .int()
    .min(EMISSION_BOUNDS.min)
    .max(EMISSION_BOUNDS.max)
    .optional(),
  emissionMax: z.coerce
    .number()
    .int()
    .min(EMISSION_BOUNDS.min)
    .max(EMISSION_BOUNDS.max)
    .optional(),
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

/** A validated `GET /products` query string. */
export type ProductQueryParams = z.infer<typeof productQueryParamsSchema>;

/** The query string of `GET /products/suggest`. */
export const suggestQueryParamsSchema = z.object({
  q: searchTermSchema.pipe(z.string().min(1).max(60)),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/** A validated suggestion query string. */
export type SuggestQueryParams = z.infer<typeof suggestQueryParamsSchema>;

/** A closed interval. Both ends are included. */
export type NumericRange = Readonly<{ min: number; max: number }>;

/** A search as the domain states it, with every absent filter an `Option`. */
export type ProductQuery = Readonly<{
  text: Option<string>;
  /** The category. Absent means all three at once. */
  kind: Option<ProductKind>;
  /** The color family asked for. Only colors carry one, so this excludes the other two. */
  family: Option<ColorFamily>;
  brandSlugs: readonly string[];
  /**
   * The finishes asked for, each naming the finishers that apply it, which is
   * what a finisher is bought for. Empty means no claim about the finish. A
   * color has no single answer, so any finish narrows the other two
   * categories to nothing.
   */
  finishes: readonly Finish[];
  /**
   * The three amounts a finish is made of. Independent of each other: a color
   * can be asked to be both coated and glowing. A finisher carries one amount,
   * so while finishes are asked for each range narrows only the finishers of
   * the finish that names it.
   */
  roughness: Option<NumericRange>;
  /** Nanometers of coating. */
  coating: Option<NumericRange>;
  emission: Option<NumericRange>;
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

/**
 * A parsed query string as a domain query.
 *
 * The one place `undefined` becomes `Option`, so nothing downstream of it has
 * to ask whether a filter was given.
 */
export const toProductQuery = (params: ProductQueryParams): ProductQuery => ({
  text: Option.filter<string>((text) => text.length > 0)(
    Option.fromNullable(params.q),
  ),
  kind: Option.fromNullable(params.category),
  family: Option.fromNullable(params.family),
  brandSlugs: params.brands,
  finishes: params.finish,
  roughness: Option.map(ordered)(
    rangeOf(params.roughnessMin, params.roughnessMax, ROUGHNESS_BOUNDS),
  ),
  // Floored at zero rather than at the coating's own minimum, so that asking
  // for "no coating" is a range the slider can express.
  coating: Option.map(ordered)(
    rangeOf(params.coatingMin, params.coatingMax, {
      min: 0,
      max: COATING_BOUNDS.max,
    }),
  ),
  emission: Option.map(ordered)(
    rangeOf(params.emissionMin, params.emissionMax, EMISSION_BOUNDS),
  ),
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

/** One image of a product, and where it sits in that product's gallery. */
export type ProductImage = Readonly<{
  /** The picture under the light theme, and under both where it does not change with the theme. */
  url: string;
  /**
   * The picture under the dark theme.
   *
   * A still of a product's scene is rendered once per theme, because the room
   * it stands in is dressed for the page around it. A photograph reads the
   * same under both, and this is `url` again.
   */
  darkUrl: string;
  alt: string;
  position: number;
}>;

/** What reviewers said, averaged. A count of zero makes the average meaningless. */
export type Rating = Readonly<{ average: number; count: number }>;

/** A foundry, named and linkable. */
export type BrandRef = Readonly<{ slug: string; name: string }>;
/**
 * What a color is: a stored hex and three stored amounts of finish.
 *
 * The three are independent — a color may be lacquered and iridescent, or
 * chalky and faintly glowing — so no one of them says what the color "is". The
 * hue, saturation and lightness come back from the database derived from the
 * hex, never written.
 */
export type ColorSpec = Readonly<{
  kind: "color";
  hex: string;
  /** Which family the hex falls in. Derived from it, never chosen. */
  family: ColorFamily;
  /** 5 is a mirror, 95 is chalk. */
  roughness: number;
  /** Nanometers of interference coating. Zero is bare paint. */
  coatingNanometers: number;
  /** How hard it gives off its own light. Zero for most colors. */
  emission: number;
  hue: number;
  saturation: number;
  lightness: number;
}>;

/**
 * The least glow worth selling as one.
 *
 * A pigment either fluoresces visibly or is not sold as fluorescent, so the
 * seed never rolls an emission under this.
 */
export const EMISSION_SPEAKS = 35;

/**
 * The least saturated a pigment can be and still fluoresce.
 *
 * Fluorescence happens in a band: the pigment absorbs light further up the
 * spectrum and hands it back in its own. A pigment with no band has none to
 * hand it back in — gray does not glow gray, it just goes white — so a
 * fluorescent pigment is always a vivid one, and there is no fluorescent
 * beige to sell. `product_fluorescence_needs_a_band` holds
 * that down.
 */
export const FLUORESCENCE_FLOOR = 50;

/** At or above this a surface has stopped returning a reflection worth naming. */
export const MATTE_FLOOR = 80;

/**
 * The axis each amount is filtered on.
 *
 * The coating and the glow start at zero rather than at the point they become
 * visible, because "none of it" is the commonest answer and has to be a place
 * the slider can reach.
 */
export const FINISH_AXES: Record<FinishProperty, NumericRange> = {
  roughness: ROUGHNESS_BOUNDS,
  coating: { min: 0, max: COATING_BOUNDS.max },
  emission: EMISSION_BOUNDS,
};

/** How each finish is written out in the filter rail. */
export const FINISH_LABELS: Record<Finish, string> = {
  roughness: "Roughness",
  iridescent: "Iridescent",
  fluorescent: "Fluorescent",
};

/** What each amount is called on screen. */
export const FINISH_AXIS_LABELS: Record<FinishProperty, string> = {
  roughness: "Roughness",
  coating: "Coating",
  emission: "Glow",
};

/** A stretch of one property's range, and which property it is a stretch of. */
export type FinishBand = Readonly<{
  property: FinishProperty;
  range: NumericRange;
}>;

/**
 * The amounts each of the three words picks out.
 *
 * A finish name is a reading of the numbers rather than a value anything
 * stores, so this is where that reading is defined as something searchable: a
 * word becomes the stretch of one amount it names. Typing "iridescent" is
 * asking for this band. The three of them name different amounts, so they
 * cannot overlap however wide each one is.
 */
export const FINISH_BANDS: Record<Finish, FinishBand> = {
  // The whole axis. A grain is a grain at either end of it — a mirror and
  // chalk are the two extremes of the same one thing being asked for.
  roughness: { property: "roughness", range: ROUGHNESS_BOUNDS },
  iridescent: { property: "coating", range: COATING_BOUNDS },
  fluorescent: {
    property: "emission",
    range: { min: EMISSION_SPEAKS, max: EMISSION_BOUNDS.max },
  },
};

/**
 * What a finisher is: the one thing it does, and how much of it.
 *
 * A sum rather than three numbers, because a finisher does one thing — the database
 * stores the other two amounts as absent and refuses a row with two of them.
 * `applies` is the discriminant, so a caller that handles all three handles
 * every finisher there can be, and one that forgets a case does not compile.
 *
 * There is no such thing as "the gloss finisher": one finisher leaves a surface at
 * 20 and the next leaves it at 15, and a shopper who wants the second is not
 * served by being sold the first.
 */
export type FinishApplication =
  | Readonly<{ applies: "roughness"; roughness: number }>
  | Readonly<{ applies: "coating"; coatingNanometers: number }>
  | Readonly<{ applies: "emission"; emission: number }>;

/** A finisher, as the catalog reports it. */
export type FinisherSpec = Readonly<{ kind: "finisher" }> & FinishApplication;

/**
 * The one amount a finisher carries, in the unit that amount is read in.
 *
 * Which unit follows from which amount it is, so there is no call site that
 * has to remember that a coating is nanometers and a glow is a percentage.
 */
export const finishAmount = (application: FinishApplication): string =>
  match(application)
    .with({ applies: "roughness" }, ({ roughness }) => `${roughness}%`)
    .with({ applies: "coating" }, ({ coatingNanometers }) => `${coatingNanometers} nm`)
    .with({ applies: "emission" }, ({ emission }) => `${emission}%`)
    .exhaustive();

/**
 * What a finisher does, as a phrase that follows its name.
 *
 * Read by anyone who cannot see the pictures, which is where the whole of a
 * finisher's answer otherwise lives.
 */
export const describeApplication = (application: FinishApplication): string =>
  match(application)
    .with(
      { applies: "roughness" },
      ({ roughness }) => `leaves a surface at ${roughness}% roughness`,
    )
    .with(
      { applies: "coating" },
      ({ coatingNanometers }) => `lays a ${coatingNanometers} nm coating`,
    )
    .with({ applies: "emission" }, ({ emission }) => `glows at ${emission}%`)
    .exhaustive();

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

/** A product as the grid shows it. */
export type ProductSummary = Readonly<{
  id: string;
  slug: string;
  name: string;
  spec: ProductSpec;
  /**
   * Which of the three shelves this product sits on.
   *
   * Mirrors `spec.kind` exactly, and is built from it, so the two cannot
   * disagree: a product's category is its kind, which makes this a second name
   * for one fact rather than a second fact. It carries the name the catalog
   * contract asks for a category by. Match on `spec` for anything that needs
   * the variant's own fields, since it brings them along.
   */
  category: ProductKind;
  priceCents: number;
  stockQuantity: number;
  brand: BrandRef;
  rating: Rating;
  primaryImage: Option<ProductImage>;
}>;

/** One review. The author is an initial, since a full name is nobody's business. */
export type ProductReview = Readonly<{
  id: string;
  rating: number;
  body: string;
  authorInitial: string;
  createdAt: string;
}>;

/** A product as its own page shows it: the summary, plus everything else. */
export type ProductDetail = ProductSummary &
  Readonly<{
    description: string;
    /** Metric is stored, imperial is derived — see `units.ts`. */
    measurements: Measurements;
    /**
     * Every image of the product, in the order they are shown.
     *
     * `primaryImage` is the first of these, so a caller that only needs one
     * takes that and never has to reason about an empty array. A color has one
     * swatch; a finisher has a set, because what it does can only be
     * shown by showing it done to something. A shifter is drawn in the browser
     * from its own two numbers and has none, so the list is empty rather than
     * absent.
     */
    images: readonly ProductImage[];
    reviews: readonly ProductReview[];
  }>;

/** One choice in the filter rail, and how many results choosing it would leave. */
export type FacetBucket = Readonly<{
  value: string;
  label: string;
  count: number;
}>;

/**
 * Every choice the filter rail offers, counted against the current search.
 *
 * Each facet is counted with its own filter lifted, so a choice already made
 * still shows what the alternatives would give.
 */
export type ProductFacets = Readonly<{
  /** The three categories, always all three, counted independently. */
  categories: readonly FacetBucket[];
  brands: readonly FacetBucket[];
  /**
   * The three finishes, always all three.
   *
   * Each counts the finishers that apply it under every other filter, the
   * range on its own amount included, which is what ticking it adds.
   */
  finishes: readonly FacetBucket[];
  /** "4 stars & up", "3 stars & up", … */
  ratings: readonly FacetBucket[];
  priceCents: NumericRange;
}>;

/** The body of `GET /products`: a page of results, and the rail beside it. */
export type ProductSearchResult = Readonly<{
  items: readonly ProductSummary[];
  facets: ProductFacets;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}>;

/** Plural, because a category names a shelf rather than a product. */
export const KIND_LABELS: Record<ProductKind, string> = {
  color: "Colors",
  finisher: "Finishers",
  shifter: "Shifters",
};

/** How each direction is written out in the filter rail and on a spec sheet. */
export const DIRECTION_LABELS: Record<ShiftDirection, string> = {
  cw: "Clockwise",
  ccw: "Counter-clockwise",
};

/** Compact enough to sit on a card: red → yellow is ↻, red → violet is ↺. */
export const DIRECTION_SYMBOLS: Record<ShiftDirection, string> = {
  cw: "↻",
  ccw: "↺",
};

/** One row of the search box's dropdown. */
export type Suggestion = Readonly<{
  kind: "product" | "brand";
  label: string;
  slug: string;
  /** Products carry their swatch so the dropdown can show it. */
  hex: Option<string>;
}>;
