/**
 * Titles and descriptions stay within the lengths search engines show in
 * full, for the fixed pages and for every product and category the seed
 * plants.
 */

import { readFileSync } from "node:fs";
import type { ProductDetail } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { Archive } from "../../api/seed/archive.ts";
import { CatalogSeo, type ProductText } from "../src/features/catalog/catalog-seo.ts";
import { Seo } from "../src/shared/seo/seo.ts";

/** The seed's catalog file, as the API's seed reads it. */
type SeedCatalog = Readonly<{
  categories: readonly Readonly<{
    name: string;
    brand: string;
    products: readonly Readonly<{ name: string; description: string; priceCents: number; properties: Readonly<Record<string, string>> }>[];
  }>[];
}>;

// Read out of the archive the repository keeps, so a fresh checkout has it.
const catalog: SeedCatalog = JSON.parse(
  new TextDecoder().decode(Archive.read(readFileSync(new URL("../../api/seed/data.zip", import.meta.url)), "catalog.json")),
);

/** Every seeded product as its page reads it, with the given rating and stock. */
const seededProducts = (rating: ProductText["rating"], stock: number): readonly ProductText[] =>
  catalog.categories.flatMap((category) => {
    const names = category.products.map((product) => product.name.toLowerCase());

    return category.products.map((product, index) => ({
      name: product.name,
      slug: `product-${index}`,
      description: product.description,
      priceCents: product.priceCents,
      stock,
      category: { name: category.name },
      brand: { name: category.brand },
      rating,
      properties: Object.entries(product.properties).map(([name, value]) => ({ name, value })),
      isNameShared: names.filter((name) => name === product.name.toLowerCase()).length > 1,
    }));
  });

describe("Seo.title", () => {
  it("adds the shop's name, and cuts a long page name at a word boundary", () => {
    expect(Seo.title("Diamond Sword - Minecraft")).toBe("Diamond Sword - Minecraft | Prism");

    const long = Seo.title("A very long product name that goes on and on past what a search engine shows");

    expect(long).toBe("A very long product name that goes on and on past | Prism");
    expect(long.length).toBeLessThanOrEqual(60);
  });

  it("cuts a single overlong word inside the word", () => {
    expect(Seo.title("x".repeat(80))).toBe(`${"x".repeat(52)} | Prism`);
  });
});

describe("Seo.description", () => {
  it("cuts a long opening at a word boundary with an ellipsis", () => {
    const text = Seo.description(["word ".repeat(60)]);

    expect(text.length).toBeGreaterThanOrEqual(155);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/word…$/);
  });

  it("keeps later fragments whole, and leaves out one that would pass the limit", () => {
    const opening = "a".repeat(100);

    expect(Seo.description([opening, "b".repeat(70), "c".repeat(54)])).toBe(`${opening}. ${"c".repeat(54)}.`);
  });

  it("ends every fragment as a sentence", () => {
    expect(Seo.description(["No stop here", "Already ends!"])).toBe("No stop here. Already ends!");
  });

  it("returns the longest text within 160 when nothing reaches 155", () => {
    expect(Seo.description(["Short.", "Also short."])).toBe("Short. Also short.");
  });
});

describe("the catalog's titles and descriptions", () => {
  const variants = [
    { label: "unrated and in stock", products: seededProducts({ average: 0, count: 0 }, 10) },
    { label: "rated and in stock", products: seededProducts({ average: 4.5, count: 12 }, 10) },
    { label: "rated once and sold out", products: seededProducts({ average: 3, count: 1 }, 0) },
  ];

  it.each(variants)("gives every seeded product a description of 155 to 160 characters, $label", ({ products }) => {
    const misses = products
      .map((product) => ({ name: product.name, description: CatalogSeo.productDescription(product) }))
      .filter(({ description }) => description.length < 155 || description.length > 160);

    expect(misses).toEqual([]);
  });

  it("gives every seeded product a unique title within 60 characters", () => {
    const titles = seededProducts({ average: 0, count: 0 }, 10).map((product) => Seo.title(CatalogSeo.productTitle(product)));

    expect(titles.filter((title) => title.length > 60)).toEqual([]);
    expect(titles.length - new Set(titles).size).toBe(0);
  });

  it("gives every seeded category a title and a description within range", () => {
    for (const category of catalog.categories) {
      const text = { name: category.name, productCount: category.products.length };
      const description = CatalogSeo.categoryDescription(text);

      expect(Seo.title(CatalogSeo.categoryTitle(text)).length).toBeLessThanOrEqual(60);
      expect(description.length, description).toBeGreaterThanOrEqual(155);
      expect(description.length, description).toBeLessThanOrEqual(160);
    }
  });
});

describe("a product page's structured data", () => {
  const product = {
    id: "p1",
    slug: "diamond-sword",
    name: "Diamond Sword",
    description: "A sword.",
    priceCents: 2500,
    stock: 3,
    category: { slug: "minecraft", name: "Minecraft" },
    brand: { slug: "mojang", name: "Mojang" },
    images: [{ id: "i1", url: "/media/sword.png", alt: "Diamond Sword", isPixelArt: true, sources: [] }],
    rating: { average: 4.25, count: 8 },
    properties: [],
    weight: { grams: 100, ounces: 3.53 },
    dimensions: { millimeters: { width: 1, height: 1, depth: 1 }, inches: { width: 0.04, height: 0.04, depth: 0.04 } },
    isNameShared: false,
  } as unknown as ProductDetail;

  it("gives the product its offer and rating, with absolute addresses", () => {
    const [entry] = CatalogSeo.productJsonLd(product, "https://shop.example")["@graph"] as Record<string, unknown>[];

    expect(entry).toMatchObject({
      "@type": "Product",
      image: ["https://shop.example/media/sword.png"],
      offers: { price: "25.00", priceCurrency: "EUR", availability: "https://schema.org/InStock", url: "https://shop.example/products/diamond-sword" },
      aggregateRating: { ratingValue: "4.3", reviewCount: 8 },
    });
  });

  it("leaves the rating out until the product has one, and says when it is sold out", () => {
    const unrated = { ...product, stock: 0, rating: { average: 0, count: 0 } } as ProductDetail;
    const [entry] = CatalogSeo.productJsonLd(unrated, "https://shop.example")["@graph"] as Record<string, unknown>[];

    expect(entry).not.toHaveProperty("aggregateRating");
    expect(entry).toMatchObject({ offers: { availability: "https://schema.org/OutOfStock" } });
  });

  it("draws the breadcrumb trail from home through the category", () => {
    const [, trail] = CatalogSeo.productJsonLd(product, "https://shop.example")["@graph"] as Record<string, unknown>[];

    expect(trail).toMatchObject({
      itemListElement: [
        { position: 1, item: "https://shop.example/" },
        { position: 2, name: "Minecraft", item: "https://shop.example/categories/minecraft" },
        { position: 3, name: "Diamond Sword" },
      ],
    });
  });
});
