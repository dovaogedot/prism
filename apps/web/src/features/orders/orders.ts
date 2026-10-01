/**
 * Orders as the pages read them. The list's filters live in the URL, whose
 * query string is the query string of `GET /orders`, key for key, so every
 * view of the list is a link and Back behaves.
 */

import { OrderStatus, type OrderDetail, type OrderList } from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";

export const OrderTime = {
  /** A moment as the customer's own clock reads it. */
  format: (iso: string): string =>
    new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),

  /** A calendar day as the customer's own calendar reads it. */
  day: (iso: string): string => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso)),
} as const;

export const OrderParams = {
  /** The statuses the URL asks for, in lifecycle order, ignoring any the shop does not know. */
  statuses: (params: URLSearchParams): readonly OrderStatus[] => {
    const asked = params.getAll("status");
    return OrderStatus.NAMES.filter((status) => asked.includes(status));
  },

  /** Whether anything narrows the list. */
  isFiltered: (params: URLSearchParams): boolean =>
    params.has("status") || params.has("from") || params.has("to"),
} as const;

export const OrderPolling = {
  INTERVAL_MS: 2000,
  /** How long a just-placed order is watched for its payment before the page leaves it to the email. */
  LIMIT_MS: 2 * 60 * 1000,

  /** Whether an order is still waiting for Stripe's word, and the page is still willing to wait. */
  watching: (status: OrderStatus | undefined, startedAt: number, now: number): boolean =>
    status === "pending_payment" && now - startedAt < OrderPolling.LIMIT_MS,
} as const;

/** One page of the signed-in customer's orders, for the query string `query`; nothing is asked while `enabled` is false. */
export const useOrders = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: ["orders", query],
    enabled,
    queryFn: ({ signal }) => Api.get<OrderList>(`/orders${query.length === 0 ? "" : `?${query}`}`, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

/** One order, opened by its owner or with a guest's key, watched while its payment is pending. */
export const useOrder = (orderId: string, key: string | undefined, startedAt: number) =>
  useQuery({
    queryKey: ["order", orderId, key],
    queryFn: ({ signal }) =>
      Api.get<OrderDetail>(`/orders/${orderId}${key === undefined ? "" : `?key=${encodeURIComponent(key)}`}`, signal),
    retry: false,
    refetchInterval: (query) =>
      OrderPolling.watching(query.state.data?.status, startedAt, Date.now()) ? OrderPolling.INTERVAL_MS : false,
  });
