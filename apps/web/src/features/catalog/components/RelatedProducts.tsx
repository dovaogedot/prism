import type { ProductSummary } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../../../shared/api/client.ts";
import { ProductRow } from "./ProductRow.tsx";

/** The product the others relate to, and the name of its category. */
export type RelatedProductsProps = Readonly<{ slug: string; categoryName: string }>;

/** Other products from the same category, in stock first. Nothing at all when there are none. */
export const RelatedProducts = ({ slug, categoryName }: RelatedProductsProps) => {
  const related = useQuery({
    queryKey: ["product", slug, "related"],
    queryFn: ({ signal }) => Api.get<{ items: readonly ProductSummary[] }>(`/products/${slug}/related`, signal),
  });

  const products = related.data?.items ?? [];
  if (products.length === 0) return null;

  return <ProductRow id="related-heading" title={`More from ${categoryName}`} products={products} />;
};
