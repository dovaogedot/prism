/**
 * Every database statement the payment service makes. The provider's
 * reference and the details are sealed on the way in and opened on the way
 * out, so nothing above this file sees ciphertext and nothing below it sees
 * plaintext.
 */

import { PaymentFailure, type OrderId } from "@prism/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.ts";
import type { PaymentId } from "../../db/ids.ts";
import { payments, type PaymentKind, type PaymentStatus } from "../../db/schema.ts";
import { Outbox, type OutboxEntry } from "../../messaging/outbox.ts";
import type { FieldCipher } from "../../platform/cipher.ts";
import { ProviderReference, type ProviderName } from "../../platform/payment-gateway.ts";

/** What a payment row keeps about how it went, sealed. */
export type PaymentDetails = z.infer<typeof PaymentDetails.schema>;
export const PaymentDetails = {
  schema: z.object({
    card: z.object({ brand: z.string(), last4: z.string() }).optional(),
    failure: PaymentFailure.schema.optional(),
    /** The provider's own sentence about a failure, for support. */
    providerMessage: z.string().optional(),
  }),
} as const;

/** A payment row, opened. */
export type PaymentRecord = Readonly<{
  id: PaymentId;
  orderId: OrderId;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  /** The provider the payment went through, which its cancel or refund goes through too. */
  provider: ProviderName;
  /** Absent until the provider has answered. */
  reference?: ProviderReference;
  details: PaymentDetails;
}>;

/** One conditional move of a payment row. */
export type PaymentTransition = Readonly<{
  paymentId: PaymentId;
  /** The row moves only from one of these. */
  from: readonly PaymentStatus[];
  to: PaymentStatus;
  reference?: ProviderReference;
  /** Replaces what the row held; left out, the row keeps its details. */
  details?: PaymentDetails;
  /** Published once the move commits, and only if the row moved. */
  message?: OutboxEntry;
  now: Date;
}>;

/** Every read and write the payment service makes. */
export type PaymentRepository = Readonly<{
  createCharge: (orderId: OrderId, amountCents: number, provider: ProviderName, now: Date) => Promise<PaymentId>;
  /** The order's refund row through `provider`, created pending if it has none. */
  ensureRefund: (orderId: OrderId, amountCents: number, provider: ProviderName, now: Date) => Promise<PaymentRecord>;
  find: (paymentId: PaymentId) => Promise<PaymentRecord | undefined>;
  findOf: (orderId: OrderId, kind: PaymentKind) => Promise<PaymentRecord | undefined>;
  /** Stores the reference without moving the status. */
  attachReference: (paymentId: PaymentId, reference: ProviderReference, now: Date) => Promise<void>;
  /** Resolves to whether the row moved. A duplicate event moves nothing and publishes nothing. */
  transition: (transition: PaymentTransition) => Promise<boolean>;
}>;

export const PaymentRepository = {
  /** The provider a row names. Rows from before the simulated provider existed name Stripe. */
  providerOf: (stored: string): ProviderName => (stored === "simulated" ? "simulated" : "stripe"),

  create: (db: Database, cipher: FieldCipher): PaymentRepository => {
    type Row = typeof payments.$inferSelect;

    const open = (row: Row): PaymentRecord => ({
      id: row.id,
      orderId: row.orderId,
      kind: row.kind,
      status: row.status,
      amountCents: row.amountCents,
      provider: PaymentRepository.providerOf(row.provider),
      ...(row.reference === null ? {} : { reference: cipher.open(row.reference, ProviderReference.schema) }),
      details: row.details === null ? {} : cipher.open(row.details, PaymentDetails.schema),
    });

    const findOf = async (orderId: OrderId, kind: PaymentKind): Promise<PaymentRecord | undefined> => {
      const [row] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.kind, kind)))
        .limit(1);
      return row === undefined ? undefined : open(row);
    };

    return {
      createCharge: async (orderId, amountCents, provider, now) => {
        const [row] = await db
          .insert(payments)
          .values({ orderId, kind: "charge", status: "pending", amountCents, provider, createdAt: now, updatedAt: now })
          .returning({ id: payments.id });
        if (row === undefined) throw new Error("payment insert returned no row");

        return row.id;
      },

      ensureRefund: async (orderId, amountCents, provider, now) => {
        await db
          .insert(payments)
          .values({ orderId, kind: "refund", status: "pending", amountCents, provider, createdAt: now, updatedAt: now })
          .onConflictDoNothing({ target: [payments.orderId, payments.kind] });

        const refund = await findOf(orderId, "refund");
        if (refund === undefined) throw new Error("refund row vanished between insert and select");

        return refund;
      },

      find: async (paymentId) => {
        const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
        return row === undefined ? undefined : open(row);
      },

      findOf,

      attachReference: async (paymentId, reference, now) => {
        await db
          .update(payments)
          .set({ reference: cipher.seal(reference), updatedAt: now })
          .where(eq(payments.id, paymentId));
      },

      transition: (transition) =>
        db.transaction(async (tx) => {
          const moved = await tx
            .update(payments)
            .set({
              status: transition.to,
              updatedAt: transition.now,
              ...(transition.reference === undefined ? {} : { reference: cipher.seal(transition.reference) }),
              ...(transition.details === undefined ? {} : { details: cipher.seal(transition.details) }),
            })
            .where(and(eq(payments.id, transition.paymentId), inArray(payments.status, [...transition.from])))
            .returning({ id: payments.id });

          if (moved.length === 0) return false;
          if (transition.message !== undefined) await Outbox.enqueue(tx, transition.message);

          return true;
        }),
    };
  },
} as const;
