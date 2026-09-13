/** The catalog file the seed plants, as `scripts/fetch-catalog.ts` writes it. */

import { z } from "zod";

/** One product of the catalog file; `image` is its picture's file name under the seed's media directory. */
export type SeedProduct = z.infer<typeof SeedProduct.schema>;

export const SeedProduct = {
  schema: z.object({
    name: z.string().min(1),
    description: z.string(),
    priceCents: z.number().int().nonnegative(),
    image: z.string().min(1),
    properties: z.record(z.string(), z.string()),
  }),
} as const;

/** The catalog file: categories, each with the brand every product on it carries. */
export type SeedCatalog = z.infer<typeof SeedCatalog.schema>;

export const SeedCatalog = {
  schema: z.object({
    categories: z.array(z.object({ name: z.string().min(1), brand: z.string().min(1), products: z.array(SeedProduct.schema) })),
  }),
} as const;
