import { describe, expect, it } from "vitest";
import { Option } from "../../src/fp/option.ts";
import {
  DEFAULT_PER_PAGE,
  describeApplication,
  finishAmount,
  FINISH_AXIS_LABELS,
  type FinishApplication,
  MAX_PER_PAGE,
  productQueryParamsSchema,
  suggestQueryParamsSchema,
  toProductQuery,
} from "../../src/contracts/catalog.ts";

const parse = (raw: Record<string, string>) => productQueryParamsSchema.parse(raw);
const query = (raw: Record<string, string>) => toProductQuery(parse(raw));

describe("productQueryParamsSchema", () => {
  it("supplies defaults for an empty query string", () => {
    expect(parse({})).toEqual({
      brands: [],
      finish: [],
      sort: "relevance",
      page: 1,
      perPage: DEFAULT_PER_PAGE,
    });
  });

  it("splits comma-separated multi-value filters", () => {
    expect(parse({ brands: "chroma-labs,cyan-and-sons" }).brands).toEqual([
      "chroma-labs",
      "cyan-and-sons",
    ]);
  });

  it("ignores empty entries and stray whitespace in those lists", () => {
    expect(parse({ brands: " chroma-labs , ,cyan-and-sons," }).brands).toEqual([
      "chroma-labs",
      "cyan-and-sons",
    ]);
  });

  it("takes any of the finishes, comma-separated like any list", () => {
    expect(parse({ finish: "iridescent,fluorescent" }).finish).toEqual([
      "iridescent",
      "fluorescent",
    ]);
  });

  it("rejects a finish it does not know", () => {
    expect(productQueryParamsSchema.safeParse({ finish: "iridescent,glitter" }).success).toBe(
      false,
    );
  });

  it("coerces numeric parameters from their string form", () => {
    const parsed = parse({ priceMin: "1000", page: "3", minRating: "4" });
    expect(parsed.priceMin).toBe(1000);
    expect(parsed.page).toBe(3);
    expect(parsed.minRating).toBe(4);
  });

  it("caps perPage so a crafted URL cannot ask for the whole table", () => {
    expect(parse({ perPage: String(MAX_PER_PAGE) }).perPage).toBe(MAX_PER_PAGE);
    expect(productQueryParamsSchema.safeParse({ perPage: "5000" }).success).toBe(false);
  });

  it("rejects slugs carrying anything but lowercase, digits and hyphens", () => {
    const payloads = [
      "reds'; DROP TABLE product; --",
      "reds OR 1=1",
      "<script>alert(1)</script>",
      "../../etc/passwd",
      "Reds",
      "reds%20blues",
    ];

    for (const payload of payloads) {
      expect(productQueryParamsSchema.safeParse({ category: payload }).success, payload).toBe(
        false,
      );
      expect(productQueryParamsSchema.safeParse({ brands: payload }).success, payload).toBe(
        false,
      );
    }
  });

  it("rejects an unknown sort rather than silently falling back", () => {
    expect(productQueryParamsSchema.safeParse({ sort: "price" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ sort: "rating; DROP TABLE" }).success).toBe(
      false,
    );
  });

  it("holds numeric filters inside their domain bounds", () => {
    expect(productQueryParamsSchema.safeParse({ hueMin: "-1" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ hueMax: "361" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ saturationMax: "101" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ minRating: "6" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ priceMin: "-100" }).success).toBe(false);
  });

  it("rejects a non-numeric value where a number is expected", () => {
    expect(productQueryParamsSchema.safeParse({ page: "one" }).success).toBe(false);
    expect(productQueryParamsSchema.safeParse({ priceMin: "1e999" }).success).toBe(false);
  });
});

describe("toProductQuery", () => {
  it("turns absent filters into None rather than undefined", () => {
    const result = query({});

    expect(result.text).toEqual(Option.none);
    expect(result.family).toEqual(Option.none);
    expect(result.price).toEqual(Option.none);
    expect(result.minRating).toEqual(Option.none);
    expect(result.hue).toEqual(Option.none);
    expect(result.saturation).toEqual(Option.none);
  });

  it("keeps empty multi-value filters as empty arrays, not absence", () => {
    const result = query({});
    expect(result.brandSlugs).toEqual([]);
    expect(result.finishes).toEqual([]);
  });

  it("carries every finish asked for", () => {
    expect(query({ finish: "fluorescent,roughness" }).finishes).toEqual([
      "fluorescent",
      "roughness",
    ]);
  });

  it("treats a blank search term as no search term", () => {
    expect(query({ q: "   " }).text).toEqual(Option.none);
  });

  it("carries a real search term through", () => {
    expect(query({ q: " screaming pumpkin " }).text).toEqual(
      Option.some("screaming pumpkin"),
    );
  });

  it("opens the far end of a one-sided price filter", () => {
    expect(query({ priceMin: "1500" }).price).toEqual(
      Option.some({ min: 1500, max: 100_000_000 }),
    );
    expect(query({ priceMax: "1500" }).price).toEqual(Option.some({ min: 0, max: 1500 }));
  });

  it("orders a backwards price range instead of returning nothing", () => {
    expect(query({ priceMin: "9000", priceMax: "1000" }).price).toEqual(
      Option.some({ min: 1000, max: 9000 }),
    );
  });

  it("orders a backwards saturation range too", () => {
    expect(query({ saturationMin: "80", saturationMax: "20" }).saturation).toEqual(
      Option.some({ min: 20, max: 80 }),
    );
  });

  it("preserves a backwards hue range, because reds wrap through 0°", () => {
    // 340° → 20° is the arc containing crimson, not an empty selection.
    expect(query({ hueMin: "340", hueMax: "20" }).hue).toEqual(
      Option.some({ min: 340, max: 20 }),
    );
  });

  it("passes pagination and sort through unchanged", () => {
    const result = query({ sort: "price_desc", page: "4", perPage: "12" });
    expect(result.sort).toBe("price_desc");
    expect(result.page).toBe(4);
    expect(result.perPage).toBe(12);
  });
});

describe("suggestQueryParamsSchema", () => {
  it("requires a non-empty term", () => {
    expect(suggestQueryParamsSchema.safeParse({ q: "" }).success).toBe(false);
    expect(suggestQueryParamsSchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("defaults the limit and caps it", () => {
    expect(suggestQueryParamsSchema.parse({ q: "red" }).limit).toBe(8);
    expect(suggestQueryParamsSchema.safeParse({ q: "red", limit: "100" }).success).toBe(false);
  });

  it("accepts free text, since the term is parameterized at the database", () => {
    expect(suggestQueryParamsSchema.parse({ q: "o'brien's red" }).q).toBe("o'brien's red");
  });
});

/** One finisher per amount, which is every finisher there can be. */
const finishers: readonly FinishApplication[] = [
  { applies: "roughness", roughness: 88 },
  { applies: "coating", coatingNanometers: 300 },
  { applies: "emission", emission: 80 },
];

describe("finishAmount", () => {
  it("writes each amount in the unit that amount is read in", () => {
    expect(finishers.map(finishAmount)).toEqual(["88%", "300 nm", "80%"]);
  });

  it("keeps the amount at either end of its range", () => {
    expect(finishAmount({ applies: "roughness", roughness: 5 })).toBe("5%");
    expect(finishAmount({ applies: "coating", coatingNanometers: 600 })).toBe("600 nm");
  });
});

describe("describeApplication", () => {
  it("says what the finisher does, in words, for a reader without the pictures", () => {
    expect(finishers.map(describeApplication)).toEqual([
      "leaves a surface at 88% roughness",
      "lays a 300 nm coating",
      "glows at 80%",
    ]);
  });

  it("names one effect per finisher and never another finisher's", () => {
    // A finisher carries one amount, so its description carries one number.
    for (const finisher of finishers) {
      expect(describeApplication(finisher).match(/\d+/g)).toHaveLength(1);
    }
  });
});

describe("FINISH_AXIS_LABELS", () => {
  it("names the row every finisher's amount goes under", () => {
    expect(finishers.map((finisher) => FINISH_AXIS_LABELS[finisher.applies])).toEqual([
      "Roughness",
      "Coating",
      "Glow",
    ]);
  });
});
