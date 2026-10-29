import { useRelatedProducts } from "../catalog.ts";
import { ProductRow } from "./ProductRow.tsx";

/** The product the others relate to, and the name of its category. */
export type RelatedProductsProps = Readonly<{ slug: string; categoryName: string }>;

/** Other products from the same category, in stock first. Nothing at all when there are none. */
export const RelatedProducts = ({ slug, categoryName }: RelatedProductsProps) => {
  const related = useRelatedProducts(slug);

  const products = related.data?.items ?? [];
  if (products.length === 0) return null;

  return <ProductRow id="related-heading" title={`More from ${categoryName}`} products={products} />;
};
