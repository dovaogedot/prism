/**
 * Orders as the API serves them. Dates travel as ISO 8601 strings and money
 * as whole cents.
 */

import { z } from "zod";
import { ProductId, type ProductImage, type Slug } from "./catalog.ts";
import type { Contact, PaymentFailure, ShippingAddress, ShippingMethod } from "./checkout.ts";

/** The identity of an order, as the database assigns it. */
export type OrderId = z.infer<typeof OrderId.schema>;
export const OrderId = {
  schema: z.uuid().brand<"OrderId">(),
} as const;

/** The number a customer quotes, as the database assigns it. */
export type OrderNumber = z.infer<typeof OrderNumber.schema>;
export const OrderNumber = {
  schema: z.number().int().positive().brand<"OrderNumber">(),
} as const;

/** The secret that opens a guest's order, carried in its links as `?key=`. */
export type OrderKey = z.infer<typeof OrderKey.schema>;
export const OrderKey = {
  schema: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .brand<"OrderKey">(),
} as const;

/** What the browser hands Stripe to confirm one payment. */
export type ClientSecret = z.infer<typeof ClientSecret.schema>;
export const ClientSecret = {
  schema: z.string().min(1).brand<"ClientSecret">(),
} as const;

/** Where an order is in its life. */
export type OrderStatus = (typeof OrderStatus.NAMES)[number];
export const OrderStatus = {
  /** In lifecycle order, which is also the order of the `status` sort. */
  NAMES: [
    "pending_payment",
    "payment_successful",
    "payment_failed",
    "processing",
    "shipped",
    "delivered",
    "canceled",
  ] as const,
  schema: z.enum([
    "pending_payment",
    "payment_successful",
    "payment_failed",
    "processing",
    "shipped",
    "delivered",
    "canceled",
  ]),
  label: {
    pending_payment: "Pending payment",
    payment_successful: "Payment successful",
    payment_failed: "Payment failed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    canceled: "Canceled",
  } as const satisfies Record<
    "pending_payment" | "payment_successful" | "payment_failed" | "processing" | "shipped" | "delivered" | "canceled",
    string
  >,
  /** The statuses a customer may still cancel from: nothing has left the warehouse. */
  CANCELABLE: ["pending_payment", "payment_successful"] as const,
  isCancelable: (status: string): boolean => (OrderStatus.CANCELABLE as readonly string[]).includes(status),
} as const;

/** The orders a list can come in. */
export type OrderSort = (typeof OrderSort.NAMES)[number];
export const OrderSort = {
  NAMES: ["newest", "oldest", "status"] as const,
  schema: z.enum(["newest", "oldest", "status"]),
  label: { newest: "Newest first", oldest: "Oldest first", status: "Status" } as const satisfies Record<
    "newest" | "oldest" | "status",
    string
  >,
} as const;

/** A calendar day as `YYYY-MM-DD`. */
export const CalendarDay = {
  schema: z.iso.date("Enter a date as YYYY-MM-DD."),
} as const;

/** The query string of `GET /orders`. Both ends of the date range count. */
export type OrderQueryParams = z.infer<typeof OrderQueryParams.schema>;
export const OrderQueryParams = {
  schema: z
    .object({
      status: z
        .union([OrderStatus.schema, z.array(OrderStatus.schema).max(7)])
        .transform((value) => (typeof value === "string" ? [value] : value))
        .optional(),
      from: CalendarDay.schema.optional(),
      to: CalendarDay.schema.optional(),
      sort: OrderSort.schema.default("newest"),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      perPage: z.coerce.number().int().min(1).max(50).default(10),
    })
    .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
      message: "The start date must not be after the end date.",
      path: ["to"],
    }),
} as const;

/** How a payment stands, as the order page shows it. */
export type PaymentSummary = Readonly<{
  status: "pending" | "succeeded" | "failed" | "canceled";
  /** Present once the provider has told which card paid. */
  card?: Readonly<{ brand: string; last4: string }>;
  failure?: PaymentFailure;
  /** Present once a refund was asked for. */
  refund?: "pending" | "succeeded" | "failed";
}>;

/** One step of an order's history. */
export type OrderEvent = Readonly<{
  status: OrderStatus;
  /** Present when the status alone does not say what happened. */
  note?: string;
  at: string;
}>;

/** One product of an order, as it was sold. */
export type OrderLine = Readonly<{
  /** Absent once the product has left the catalog. */
  productId?: ProductId;
  slug: Slug;
  name: string;
  image?: ProductImage;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}>;

/** An order as a list shows it. */
export type OrderSummary = Readonly<{
  id: OrderId;
  number: OrderNumber;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  itemCount: number;
  /** The first line's picture, when it has one. */
  image?: ProductImage;
}>;

/** One page of orders. */
export type OrderList = Readonly<{
  items: readonly OrderSummary[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}>;

/** An order as its own page shows it. */
export type OrderDetail = Readonly<{
  id: OrderId;
  number: OrderNumber;
  status: OrderStatus;
  createdAt: string;
  contact: Contact;
  address: ShippingAddress;
  shippingMethod: ShippingMethod;
  lines: readonly OrderLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  /** Oldest first. */
  events: readonly OrderEvent[];
  /** Absent when no payment was ever started. */
  payment?: PaymentSummary;
  /** Present once the order has shipped. */
  trackingNumber?: string;
  cancelable: boolean;
  /** When an unpaid order expires; present while the payment is pending. */
  paymentDueAt?: string;
}>;

/** What `POST /orders` answers: the order, and what the browser needs to pay for it. */
export type PlaceOrderResult = Readonly<{
  orderId: OrderId;
  number: OrderNumber;
  /** Present for a guest's order: the only way back to it. */
  key?: OrderKey;
  clientSecret: ClientSecret;
}>;
