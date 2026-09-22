/**
 * The identities the database assigns to rows the code refers to by id.
 * Opaque: only a schema makes one, so an id of one table cannot be passed
 * where another table's id goes.
 */

import { z } from "zod";

/** The identity of a session. */
export type SessionId = z.infer<typeof SessionId.schema>;
export const SessionId = {
  schema: z.uuid().brand<"SessionId">(),
} as const;

/** The identity of a category. */
export type CategoryId = z.infer<typeof CategoryId.schema>;
export const CategoryId = {
  schema: z.uuid().brand<"CategoryId">(),
} as const;

/** The identity of a brand. */
export type BrandId = z.infer<typeof BrandId.schema>;
export const BrandId = {
  schema: z.uuid().brand<"BrandId">(),
} as const;
