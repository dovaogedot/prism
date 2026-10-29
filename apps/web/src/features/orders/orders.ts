/**
 * Orders as the pages read them. The list's filters live in the URL, whose
 * query string is the query string of `GET /orders`, key for key, so every
 * view of the list is a link and Back behaves.
 */

import { OrderStatus, type OrderDetail, type OrderList, type PaymentSummary } from "@prism/shared"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
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
  INTERVAL_MS: 2000,
  /** How long a just-placed order is watched for its payment before the page leaves it to the email. */
  LIMIT_MS: 2 * 60 * 1000,

  /** Whether an order is still waiting for Stripe's word, and the page is still willing to wait. */
  watching: (status: OrderStatus | undefined, startedAt: number, now: number): boolean =>
    status === "pending_payment" && now - startedAt < OrderPolling.LIMIT_MS,
} as const

/** One page of the signed-in customer's orders, for the query string `query`. */
export const useOrders = (query: string) =>
  useQuery({
    queryKey: OrderKeys.list(query),
    queryFn: ({ signal }) => Api.get<OrderList>(Api.withQuery("/orders", query), signal),
    placeholderData: keepPreviousData,
    retry: false,
  })

/** One order, opened by its owner or with a guest's key, watched while its payment is pending; fetched only when `enabled`. */
export const useOrder = (orderId: string, key: string | undefined, startedAt: number, enabled: boolean) =>
  useQuery({
    queryKey: OrderKeys.one(orderId, key),
    enabled,
    queryFn: ({ signal }) =>
      Api.get<OrderDetail>(`/orders/${orderId}${key === undefined ? "" : `?key=${encodeURIComponent(key)}`}`, signal),
    retry: false,
    refetchInterval: (query) => (OrderPolling.watching(query.state.data?.status, startedAt, Date.now()) ? OrderPolling.INTERVAL_MS : false),
  })
