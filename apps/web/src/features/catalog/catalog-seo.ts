/**
 * What search engines read for the catalog's own pages: a title and a
 * description for each product and each category, built from their data.
 */

import { Price, type ProductDetail, type Rating } from "@prism/shared";
import { Seo } from "../../shared/seo/seo.ts";

/** What a product page's title and description are made from. */
export type ProductText = Readonly<{
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  stock: number;
  category: Readonly<{ name: string }>;
  brand: Readonly<{ name: string }>;
  rating: Rating;
  properties: readonly Readonly<{ name: string; value: string }>[];
  /** Whether another product in the same category has the same name. */
  isNameShared: boolean;
}>;

/** What a category page's title and description are made from. */
export type CategoryText = Readonly<{ name: string; description?: string; productCount: number }>;

export const CatalogSeo = {
  /**
   * What every catalog description may close with. Their lengths differ, so
   * some of them always fill what the page's own facts leave short of 155.
   */
  CLOSING: [
    "Tracked delivery across Europe.",
    "Returns within 14 days.",
    "Secure card payment.",
    "Order today at Prism.",
    "Buy now.",
  ],

  /**
   * The product's name and category. Two products of one category that
   * share a name are told apart by their `type` property, which names what
   * kind of thing each is, or by their slug when they have none.
   */
  productTitle: (product: ProductText): string => {
    const base = `${product.name} - ${product.category.name}`;
    if (!product.isNameShared) return base;

    const type = product.properties.find((property) => property.name.toLowerCase() === "type")?.value ?? product.slug;
    return `${product.name} (${type}) - ${product.category.name}`;
  },

  /** The product's own description first, then what it is, how it rates, its price and how it ships. */
  productDescription: (product: ProductText): string => {
    const { count, average } = product.rating;
    const price = Price.format(product.priceCents);

    return Seo.description([
      product.description,
      `${product.name} by ${product.brand.name}, from the ${product.category.name} collection.`,
      ...(count === 0 ? [] : [`Rated ${average.toFixed(1)} out of 5 by ${count} ${count === 1 ? "customer" : "customers"}.`]),
      product.stock > 0 ? `In stock at ${price}.` : `${price}, currently out of stock.`,
      ...CatalogSeo.CLOSING,
    ]);
  },

  categoryTitle: (category: CategoryText): string => `${category.name} items`,

  /**
   * The structured data of a product page, as schema.org reads it: the
   * product with its offer and, once reviewed, its rating, and the
   * breadcrumb trail to it. Every address is absolute, under `origin`.
   */
  productJsonLd: (product: ProductDetail, origin: string): Readonly<Record<string, unknown>> => {
    const url = `${origin}/products/${product.slug}`;

    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          name: product.name,
          description: product.description,
          sku: product.slug,
          url,
          image: product.images.map((image) => `${origin}${image.url}`),
          brand: { "@type": "Brand", name: product.brand.name },
          category: product.category.name,
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: "EUR",
            price: (product.priceCents / 100).toFixed(2),
            availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            itemCondition: "https://schema.org/NewCondition",
          },
          ...(product.rating.count === 0
            ? {}
            : { aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating.average.toFixed(1), reviewCount: product.rating.count } }),
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
            { "@type": "ListItem", position: 2, name: product.category.name, item: `${origin}/categories/${product.category.slug}` },
            { "@type": "ListItem", position: 3, name: product.name, item: url },
          ],
        },
      ],
    };
  },

  /** The category's own description when it has one, then how many items it holds and how to find one. */
  categoryDescription: (category: CategoryText): string => {
    const items = `${category.productCount} ${category.name} ${category.productCount === 1 ? "item" : "items"}`;

    return Seo.description([
      category.description ?? `Shop ${items} at Prism.`,
      ...(category.description === undefined ? [] : [`Shop ${items} at Prism.`]),
      "Filter by price, rating and properties, and sort by price, rating or what is new.",
      ...CatalogSeo.CLOSING,
    ]);
  },
} as const;
