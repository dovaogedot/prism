import { describe, expect, it } from "vitest";
import {
  Dimensions,
  Price,
  ProductQuery,
  ProductQueryParams,
  SearchText,
  SuggestParams,
  Weight,
} from "../../src/contracts/catalog.ts";
import { ReviewInput } from "../../src/contracts/reviews.ts";

describe("ProductQueryParams", () => {
  it("applies defaults to an empty query string", () => {
    expect(ProductQueryParams.schema.parse({})).toEqual({
      sort: "relevance",
      page: 1,
      perPage: 12,
    });
  });

  it("accepts a single value or a repeated key for list filters", () => {
    expect(ProductQueryParams.schema.parse({ brand: "acme" }).brand).toEqual(["acme"]);
    expect(ProductQueryParams.schema.parse({ brand: ["acme", "globex"] }).brand).toEqual([
      "acme",
      "globex",
    ]);
  });

  it("rejects out-of-range paging and unknown sorts", () => {
    expect(ProductQueryParams.schema.safeParse({ page: 0 }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ perPage: 61 }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ sort: "cheapest" }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ rating: 6 }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ priceMin: "abc" }).success).toBe(false);
  });

  it("rejects control characters in the search text", () => {
    expect(ProductQueryParams.schema.safeParse({ q: "lamp\x00" }).success).toBe(false);
    expect(SearchText.schema.safeParse("a\tb").success).toBe(false);
  });

  it("rejects a category that is not a slug", () => {
    expect(ProductQueryParams.schema.safeParse({ category: "Not A Slug" }).success).toBe(false);
  });
});

describe("ProductQuery.fromParams", () => {
  it("turns prefixed keys into property filters and leaves other keys alone", () => {
    const query = ProductQuery.fromParams(
      ProductQueryParams.schema.parse({
        "p.color": ["red", "blue"],
        "p.size": "m",
        "p.": "ignored",
        unrelated: "x",
        brand: "acme",
        q: "  lamp ",
        priceMin: "100",
        rating: "4",
      }),
    );

    expect(query).toEqual({
      text: "lamp",
      brands: ["acme"],
      priceMinCents: 100,
      minRating: 4,
      properties: [
        { name: "color", values: ["red", "blue"] },
        { name: "size", values: ["m"] },
      ],
      sort: "relevance",
      page: 1,
      perPage: 12,
    });
  });

  it("treats blank text as no text filter", () => {
    const query = ProductQuery.fromParams(ProductQueryParams.schema.parse({ q: "   " }));
    expect(query).not.toHaveProperty("text");
  });
});

describe("SuggestParams", () => {
  it("needs at least one character and caps the limit", () => {
    expect(SuggestParams.schema.safeParse({ q: " " }).success).toBe(false);
    expect(SuggestParams.schema.parse({ q: "la" })).toEqual({ q: "la", limit: 8 });
    expect(SuggestParams.schema.safeParse({ q: "la", limit: 21 }).success).toBe(false);
  });
});

describe("measurements", () => {
  it("derives ounces from grams", () => {
    expect(Weight.fromGrams(1000)).toEqual({ grams: 1000, ounces: 35.27 });
  });

  it("derives inches from millimeters", () => {
    expect(Dimensions.fromMillimeters({ width: 254, height: 127, depth: 25 })).toEqual({
      millimeters: { width: 254, height: 127, depth: 25 },
      inches: { width: 10, height: 5, depth: 0.98 },
    });
  });
});

describe("Price.format", () => {
  it("renders cents as a currency amount", () => {
    expect(Price.format(1999)).toBe("€19.99");
  });
});

describe("numbers that reach Postgres", () => {
  it("refuses a price filter past what an integer column holds", () => {
    expect(ProductQueryParams.schema.safeParse({ priceMax: "2147483647" }).success).toBe(true);
    expect(ProductQueryParams.schema.safeParse({ priceMax: "2147483648" }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ priceMin: "9007199254740991" }).success).toBe(false);
  });
});

describe("text that reaches Postgres", () => {
  it("counts a review's byline and texts in characters, as the database's checks do", () => {
    const review = (fields: Readonly<Record<string, string>>) => ReviewInput.schema.safeParse({ rating: 4, authorName: "Mari", ...fields }).success;

    expect(review({ authorName: "😀" })).toBe(false);
    expect(review({ authorName: "😀😀" })).toBe(true);
    expect(review({ authorName: "😀".repeat(40) })).toBe(true);
    expect(review({ authorName: "😀".repeat(41) })).toBe(false);
    expect(review({ title: "😀".repeat(120) })).toBe(true);
    expect(review({ title: "😀".repeat(121) })).toBe(false);
  });

  it("refuses the NUL character, which Postgres cannot store or compare", () => {
    expect(ProductQueryParams.schema.safeParse({ "p.color": "\u0000" }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ "p.color": ["red", "\u0000"] }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ "p.\u0000": "red" }).success).toBe(false);
    expect(ProductQueryParams.schema.safeParse({ "p.color": "red" }).success).toBe(true);
    expect(ReviewInput.schema.safeParse({ rating: 4, authorName: "Mari", body: "Bright\u0000" }).success).toBe(false);
    expect(ReviewInput.schema.safeParse({ rating: 4, authorName: "Mari", body: "Bright\nand steady" }).success).toBe(true);
  });
});
