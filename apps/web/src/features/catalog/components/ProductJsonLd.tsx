import type { ProductDetail } from "@prism/shared";
import { CatalogSeo } from "../catalog-seo.ts";

/** The product the data describes. */
export type ProductJsonLdProps = Readonly<{ product: ProductDetail }>;

/**
 * The product page's structured data, in a JSON-LD block. It is data, not a
 * script a browser runs, so the Content-Security-Policy leaves it alone.
 */
export const ProductJsonLd = ({ product }: ProductJsonLdProps) => (
  <script
    type="application/ld+json"
    // A "<" inside a value could close the element early, so every one is escaped.
    dangerouslySetInnerHTML={{ __html: JSON.stringify(CatalogSeo.productJsonLd(product, window.location.origin)).replaceAll("<", "\\u003c") }}
  />
);
