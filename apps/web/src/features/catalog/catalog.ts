/** The catalog reads more than one page shares. */

import type { CategorySummary, ProductSummary } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";

/** Every category with its product count and a picture, by name. */
export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) => Api.getPublic<{ items: readonly CategorySummary[] }>("/categories", signal),
    select: (data) => data.items,
    // The categories change when staff change them, which is rare.
    staleTime: 5 * 60_000,
  });

/** The query keys of one product: its page, and the products related to it. */
export const ProductKeys = {
  one: (slug: string) => ["product", slug] as const,
  related: (slug: string) => ["product", slug, "related"] as const,
} as const;

/** Other products from the same category as `slug`, in stock first. */
export const useRelatedProducts = (slug: string) =>
  useQuery({
    queryKey: ProductKeys.related(slug),
    queryFn: ({ signal }) => Api.getPublic<{ items: readonly ProductSummary[] }>(`/products/${slug}/related`, signal),
  });
