/** The catalog reads more than one page shares. */

import type { CategorySummary } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";

/** Every category with its product count and a picture, by name. */
export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) => Api.get<{ items: readonly CategorySummary[] }>("/categories", signal),
    select: (data) => data.items,
    // The categories change when staff change them, which is rare.
    staleTime: 5 * 60_000,
  });
