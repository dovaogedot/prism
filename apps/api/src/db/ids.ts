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

/** Categories and brands are named on the wire too, so their ids live with the shared contracts. */
export { BrandId, CategoryId } from "@prism/shared";

/** The identity of a cart. */
export type CartId = z.infer<typeof CartId.schema>;
export const CartId = {
  schema: z.uuid().brand<"CartId">(),
} as const;

/** The identity of a payment row: one charge or one refund. */
export type PaymentId = z.infer<typeof PaymentId.schema>;
export const PaymentId = {
  schema: z.uuid().brand<"PaymentId">(),
} as const;

/** The identity of an audit log entry. Increasing, so it also orders entries written in one instant. */
export type AuditEventId = z.infer<typeof AuditEventId.schema>;
export const AuditEventId = {
  schema: z.number().int().positive().brand<"AuditEventId">(),
} as const;
