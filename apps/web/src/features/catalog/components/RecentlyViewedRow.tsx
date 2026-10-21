import type { ProductDetail } from "@prism/shared";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { Api } from "../../../shared/api/client.ts";
import { RecentlyViewed } from "../recently-viewed.ts";
import { ProductRow } from "./ProductRow.tsx";

/** The product the page is about, which the row leaves out. */
export type RecentlyViewedRowProps = Readonly<{ exclude?: string }>;

/**
 * The products this browser opened last, newest first. Nothing at all
 * until the browser has opened some, and a product since removed from the
 * shop is left out.
 */
export const RecentlyViewedRow = ({ exclude }: RecentlyViewedRowProps) => {
  const slugs = useMemo(() => RecentlyViewed.read().filter((slug) => slug !== exclude).slice(0, 4), [exclude]);

  const products = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["product", slug],
      queryFn: ({ signal }: Readonly<{ signal: AbortSignal }>) => Api.get<ProductDetail>(`/products/${slug}`, signal),
      retry: false,
    })),
  });

  const shown = products.flatMap((product) => (product.data === undefined ? [] : [product.data]));
  if (shown.length === 0) return null;

  return <ProductRow id="recent-heading" title="Recently viewed" products={shown} />;
};
