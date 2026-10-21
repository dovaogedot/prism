/**
 * The cart as the page holds it. The server is the source of truth: every
 * change answers with the whole cart, which replaces the cached one. Until
 * it answers, a quantity change or a removal shows at once, with totals from
 * the same `Pricing` the server charges with, and is rolled back if refused.
 */

import { Price, Pricing, type CartView, type ProductId, type ProductSummary, type ShippingOption, type UserId } from "@prism/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";
import { Failure } from "../auth/components/failure.tsx";
import { useSession } from "../auth/session.ts";

/** How far a cart is from shipping free. */
export const FreeShipping = {
  /** The option that ships free soonest, by its threshold; `undefined` when none ever does. */
  nearest: (options: readonly ShippingOption[]): ShippingOption | undefined =>
    options
      .filter((option) => option.freeFromCents !== undefined)
      .toSorted((a, b) => (a.freeFromCents ?? 0) - (b.freeFromCents ?? 0))[0],

  /** The sentence the cart shows about free shipping; `undefined` when no option ships free. */
  sentenceOf: (options: readonly ShippingOption[], subtotalCents: number): string | undefined => {
    const option = FreeShipping.nearest(options);
    if (option === undefined) return undefined;

    const missing = Pricing.untilFree(option, subtotalCents) ?? 0;
    return missing > 0
      ? `Add ${Price.format(missing)} more for free ${option.name.toLowerCase()} shipping.`
      : `${option.name} shipping is free for this order.`;
  },
} as const;

export const CartCache = {
  /** One cache entry per owner, so signing in fetches the merged cart rather than showing the guest's. */
  key: (userId: UserId | undefined) => ["cart", userId ?? "guest"] as const,

  recommendationsKey: (userId: UserId | undefined) => ["cart", userId ?? "guest", "recommendations"] as const,

  /** The view with one line at `quantity` and every total recomputed. A line not in the view changes nothing. */
  withQuantity: (view: CartView, productId: ProductId, quantity: number): CartView => {
    const lines = view.lines.map((line) =>
      line.productId === productId
        ? { ...line, quantity, lineTotalCents: Pricing.lineTotal({ unitPriceCents: line.unitPriceCents, quantity }) }
        : line,
    );

    return { lines, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotalCents: Pricing.subtotal(lines) };
  },

  /** The view without one line, with every total recomputed. */
  without: (view: CartView, productId: ProductId): CartView => {
    const lines = view.lines.filter((line) => line.productId !== productId);

    return { lines, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotalCents: Pricing.subtotal(lines) };
  },

  /** Stores the server's answer, and lets the recommendations follow the new contents. */
  settle: (client: QueryClient, userId: UserId | undefined, view: CartView): void => {
    client.setQueryData(CartCache.key(userId), view);
    void client.invalidateQueries({ queryKey: CartCache.recommendationsKey(userId) });
  },
} as const;

export const CartFailure = {
  /** The sentence for a refused change: the product's own issue, such as "Only 2 left.", when there is one. */
  message: (reason: unknown): string => {
    const failure = Api.failureOf(reason);
    if (failure === undefined) return Failure.OFFLINE;

    return failure.issues[0]?.message ?? failure.message;
  },
} as const;

/** The caller's cart, guest or signed in. */
export const useCart = () => {
  const userId = useSession()?.id;

  return useQuery({
    queryKey: CartCache.key(userId),
    queryFn: ({ signal }) => Api.get<CartView>("/cart", signal),
  });
};

/** Products like the ones in the cart. */
export const useRecommendations = () => {
  const userId = useSession()?.id;

  return useQuery({
    queryKey: CartCache.recommendationsKey(userId),
    queryFn: ({ signal }) => Api.get<{ items: readonly ProductSummary[] }>("/cart/recommendations", signal),
  });
};

/** A change to one line, as the mutations take it. */
export type LineChange = Readonly<{ productId: ProductId; quantity: number }>;

/** Adding, setting and removing, each answering with the whole cart. */
export const useCartChanges = () => {
  const client = useQueryClient();

  const userId = useSession()?.id;

  const key = CartCache.key(userId);

  /** Shows `next` at once and hands back what to restore if the server refuses. */
  const optimistic = async (next: (view: CartView) => CartView): Promise<CartView | undefined> => {
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<CartView>(key);

    if (previous !== undefined) client.setQueryData(key, next(previous));
    return previous;
  };

  const restore = (previous: CartView | undefined): void => {
    if (previous !== undefined) client.setQueryData(key, previous);
  };

  const add = useMutation({
    mutationFn: (change: LineChange) => Api.post<CartView>("/cart/items", change),
    onSuccess: (view) => CartCache.settle(client, userId, view),
  });

  const setQuantity = useMutation({
    mutationFn: (change: LineChange) => Api.put<CartView>(`/cart/items/${change.productId}`, { quantity: change.quantity }),
    onMutate: (change) => optimistic((view) => CartCache.withQuantity(view, change.productId, change.quantity)),
    onError: (_reason, _change, previous) => restore(previous),
    onSuccess: (view) => CartCache.settle(client, userId, view),
  });

  const remove = useMutation({
    mutationFn: (productId: ProductId) => Api.delete<CartView>(`/cart/items/${productId}`),
    onMutate: (productId) => optimistic((view) => CartCache.without(view, productId)),
    onError: (_reason, _productId, previous) => restore(previous),
    onSuccess: (view) => CartCache.settle(client, userId, view),
  });

  return { add, setQuantity, remove };
};
