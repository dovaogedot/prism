/**
 * The messages on the queue. They carry ids and codes only, never personal
 * data: a consumer reads what it needs from its own tables.
 */

import { OrderId, PaymentFailure } from "@prism/shared";
import { z } from "zod";
import { PaymentId } from "../db/ids.ts";
import type { OutboxEntry } from "./outbox.ts";
import { Topology } from "./topology.ts";

/** The payment service's word on a charge or refund, for the order service. */
export type PaymentStatusChanged = z.infer<typeof PaymentStatusChanged.schema>;
export const PaymentStatusChanged = {
  schema: z.object({
    orderId: OrderId.schema,
    paymentId: PaymentId.schema,
    outcome: z.enum(["succeeded", "failed", "refunded"]),
    /** Present when the outcome is `failed`. */
    failure: PaymentFailure.schema.optional(),
  }),
} as const;

/** An order that will not be paid for, or whose payment must be given back. */
export type OrderCanceled = z.infer<typeof OrderCanceled.schema>;
export const OrderCanceled = {
  schema: z.object({ orderId: OrderId.schema }),
} as const;

/** A shipped or delivered order the shop refunds in full. */
export type OrderRefundRequested = z.infer<typeof OrderRefundRequested.schema>;
export const OrderRefundRequested = {
  schema: z.object({ orderId: OrderId.schema }),
} as const;

/** Each message as the outbox entry that publishes it. */
export const Messages = {
  paymentStatus: (message: PaymentStatusChanged): OutboxEntry => ({
    exchange: Topology.PAYMENTS_EXCHANGE,
    routingKey: Topology.PAYMENT_STATUS_KEY,
    body: message,
  }),

  orderCanceled: (message: OrderCanceled): OutboxEntry => ({
    exchange: Topology.ORDERS_EXCHANGE,
    routingKey: Topology.ORDER_CANCELED_KEY,
    body: message,
  }),

  refundRequested: (message: OrderRefundRequested): OutboxEntry => ({
    exchange: Topology.ORDERS_EXCHANGE,
    routingKey: Topology.REFUND_REQUESTED_KEY,
    body: message,
  }),
} as const;
