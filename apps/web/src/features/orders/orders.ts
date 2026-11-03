/**
 * Orders as the pages read them. The list's filters live in the URL, whose
 * query string is the query string of `GET /orders`, key for key, so every
 * view of the list is a link and Back behaves.
 */

import { OrderStatus, type OrderDetail, type OrderList, type PaymentSummary } from "@prism/shared"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { match } from "ts-pattern"
import { Api } from "../../shared/api/client.ts"

/** The query keys of orders: one order as its owner or a guest's key opens it, and the lists. */
export const OrderKeys = {
  lists: ["orders"] as const,
  list: (query: string) => ["orders", query] as const,
  one: (orderId: string, key: string | undefined) => ["order", orderId, key] as const,
} as const

/** How a payment and its refund read, on the customer's and the staff's order pages alike. */
export const PaymentWords = {
  status: {
    pending: "Waiting for the payment",
    succeeded: "Paid",
    failed: "Failed",
    canceled: "Not charged",
  } as const satisfies Record<PaymentSummary["status"], string>,
  refund: {
    pending: "Refund on its way",
    succeeded: "Refunded",
    failed: "The refund failed",
  } as const satisfies Record<NonNullable<PaymentSummary["refund"]>, string>,
} as const

export const OrderParams = {
  /** The statuses the URL asks for, in lifecycle order, ignoring any the shop does not know. */
  statuses: (params: URLSearchParams): readonly OrderStatus[] => {
    const asked = params.getAll("status")
    return OrderStatus.NAMES.filter((status) => asked.includes(status))
  },

  /** Whether anything narrows the list. */
  isFiltered: (params: URLSearchParams): boolean => params.has("status") || params.has("from") || params.has("to"),
} as const

export const OrderPolling = {
  /** The first wait between two reads of an order whose payment is pending, in milliseconds; each wait after it doubles. */
  FIRST_INTERVAL_MS: 250,
  /** The longest wait between two reads, in milliseconds. */
  INTERVAL_MS: 2000,
  /** How long a just-placed order is watched for its payment before the page leaves it to the email. */
  LIMIT_MS: 2 * 60 * 1000,

  /** Whether an order is still waiting for Stripe's word, and the page is still willing to wait. */
  watching: (status: OrderStatus | undefined, startedAt: number, now: number): boolean =>
    status === "pending_payment" && now - startedAt < OrderPolling.LIMIT_MS,

  /**
   * How long to wait before reading the order again once `reads` reads have
   * answered: short at first, when a payment most often settles, then
   * doubling up to `INTERVAL_MS`.
   */
  findInterval: (reads: number): number => Math.min(OrderPolling.INTERVAL_MS, OrderPolling.FIRST_INTERVAL_MS * 2 ** Math.max(0, reads - 1)),
} as const

/**
 * Where an order stands, read from one answer of `GET /orders/:id`. The
 * answer reads the order before its timeline, and every move of the order
 * adds to its timeline as it happens, so a move made in between shows in
 * the timeline first.
 */
export const OrderStanding = {
  /** The newest status the shop has recorded for the order. */
  readRecorded: (order: Pick<OrderDetail, "status" | "events">): OrderStatus => order.events.at(-1)?.status ?? order.status,

  /**
   * The status the order's page shows. A payment settles a moment before
   * the order hears of it through the queue, so an order still recorded as
   * waiting for its payment shows the outcome its payment already has.
   */
  readShown: (order: Pick<OrderDetail, "status" | "events" | "payment">): OrderStatus => {
    const recorded = OrderStanding.readRecorded(order)
    if (recorded !== "pending_payment") return recorded

    return match(order.payment?.status)
      .returnType<OrderStatus>()
      .with("succeeded", () => "payment_successful")
      .with("failed", () => "payment_failed")
      .otherwise(() => recorded)
  },
} as const

/** One page of the signed-in customer's orders, for the query string `query`. */
export const useOrders = (query: string) =>
  useQuery({
    queryKey: OrderKeys.list(query),
    queryFn: ({ signal }) => Api.get<OrderList>(Api.withQuery("/orders", query), signal),
    placeholderData: keepPreviousData,
    retry: false,
  })

/**
 * One order, opened by its owner or with a guest's key, read again and again
 * while its payment is pending, more often at first; fetched only when
 * `enabled`.
 */
export const useOrder = (orderId: string, key: string | undefined, startedAt: number, enabled: boolean) =>
  useQuery({
    queryKey: OrderKeys.one(orderId, key),
    enabled,
    queryFn: ({ signal }) =>
      Api.get<OrderDetail>(`/orders/${orderId}${key === undefined ? "" : `?key=${encodeURIComponent(key)}`}`, signal),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data === undefined ? undefined : OrderStanding.readRecorded(query.state.data)

      return OrderPolling.watching(status, startedAt, Date.now()) ? OrderPolling.findInterval(query.state.dataUpdateCount) : false
    },
  })
