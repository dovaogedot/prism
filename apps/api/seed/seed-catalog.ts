/** The catalog file the seed plants, as `fetch/fetch-catalog.ts` writes it. */

import { z } from "zod"

/** A property's value as the catalog file holds it. */
export const SeedPropertyValue = {
  /**
   * `value` in the one spelling the catalog keeps for what it says, so a
   * filter lists it once: a count of rooms reads "1 room" or "4 rooms",
   * however its source wrote the case and the plural.
   */
  normalize: (value: string): string => {
    const rooms = /^(\d+) rooms?$/i.exec(value)?.[1]
    if (rooms === undefined) return value

    return rooms === "1" ? "1 room" : `${rooms} rooms`
  },
} as const

/** One product of the catalog file; `image` is its picture's file name under the seed's media directory. */
export type SeedProduct = z.infer<typeof SeedProduct.schema>

export const SeedProduct = {
  schema: z.object({
    name: z.string().min(1),
    description: z.string(),
    priceCents: z.number().int().nonnegative(),
    image: z.string().min(1),
    properties: z.record(z.string(), z.string().transform(SeedPropertyValue.normalize)),
  }),
} as const

/** The catalog file: categories, each with the brand every product on it carries. */
export type SeedCatalog = z.infer<typeof SeedCatalog.schema>

export const SeedCatalog = {
  schema: z.object({
    categories: z.array(z.object({ name: z.string().min(1), brand: z.string().min(1), products: z.array(SeedProduct.schema) })),
  }),
} as const
