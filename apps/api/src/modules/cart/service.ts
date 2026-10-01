/**
 * Cart logic over the repository. A request is from a user, a guest with a
 * cart cookie, or both: right after signing in, the browser still carries
 * the guest cookie, and the first cart request merges that cart into the
 * account's and spends the cookie.
 */

import {
  Cart,
  type CartView,
  type DomainError,
  type ProductId,
  type ProductSummary,
  type QuantityCheck,
  type UserId,
} from "@prism/shared";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { CartId } from "../../db/ids.ts";
import { Clock } from "../../platform/clock.ts";
import { CartToken, OpaqueToken } from "../../platform/tokens.ts";
import type { CatalogRepository } from "../catalog/repository.ts";
import { CartRepository } from "./repository.ts";

/** Who a cart request is from. Either, both or neither may be present. */
export type CartOwner = Readonly<{ userId?: UserId; guestToken?: CartToken }>;

/** What the response does with the guest cookie. */
export type CookieEffect =
  | Readonly<{ _tag: "Keep" }>
  | Readonly<{ _tag: "Set"; token: CartToken; expiresAt: Date }>
  | Readonly<{ _tag: "Clear" }>;

/** An answer, and what has to happen to the guest cookie alongside it. */
export type CartOutcome<T> = Readonly<{ value: T; cookie: CookieEffect }>;

/** The ports the cart works through. */
export type CartDependencies = Readonly<{
  repository: CartRepository;
  catalog: CatalogRepository;
  clock: Clock;
  guestCartTtlSeconds: number;
}>;

/** Every cart operation. Stock failures are `OutOfStock` with one issue keyed by product id. */
export type CartService = Readonly<{
  view: (owner: CartOwner) => Promise<CartOutcome<CartView>>;
  add: (owner: CartOwner, productId: ProductId, quantity: number) => ResultAsync<CartOutcome<CartView>, DomainError>;
  setQuantity: (
    owner: CartOwner,
    productId: ProductId,
    quantity: number,
  ) => ResultAsync<CartOutcome<CartView>, DomainError>;
  /** Answers the cart whether or not the line was in it. */
  remove: (owner: CartOwner, productId: ProductId) => Promise<CartOutcome<CartView>>;
  /** Products like the ones in the cart, or the best rated when it is empty. */
  recommendations: (owner: CartOwner) => Promise<CartOutcome<readonly ProductSummary[]>>;
  /** The caller's cart, merged if need be, without creating one. */
  locate: (owner: CartOwner) => Promise<CartOutcome<CartId | undefined>>;
}>;

export const CartService = {
  RECOMMENDATIONS: 4,

  create: (deps: CartDependencies): CartService => {
    const { repository, clock } = deps;
    const keep: CookieEffect = { _tag: "Keep" };

    /**
     * Finds the cart the request means, merging a guest cart into a signed-in
     * user's. `create` makes one when there is none, and extends a guest
     * cart's life, because a write is about to follow.
     */
    const resolve = async (owner: CartOwner, create: boolean): Promise<CartOutcome<CartId | undefined>> => {
      const guestCartId =
        owner.guestToken === undefined
          ? undefined
          : await repository.findByToken(OpaqueToken.digest(owner.guestToken), clock.now());

      if (owner.userId !== undefined) {
        const existing = await repository.findByUser(owner.userId);
        const needed = create || guestCartId !== undefined;
        const userCartId = existing === undefined && needed ? await repository.ensureForUser(owner.userId) : existing;

        if (guestCartId !== undefined && userCartId !== undefined) await repository.merge(guestCartId, userCartId);

        // A guest cookie is spent once its owner signs in, whatever it still pointed at.
        return { value: userCartId, cookie: owner.guestToken === undefined ? keep : { _tag: "Clear" } };
      }

      if (guestCartId !== undefined) {
        if (!create || owner.guestToken === undefined) return { value: guestCartId, cookie: keep };

        const expiresAt = Clock.after(clock, deps.guestCartTtlSeconds);
        await repository.extendGuest(guestCartId, expiresAt);

        return { value: guestCartId, cookie: { _tag: "Set", token: owner.guestToken, expiresAt } };
      }

      // A cookie that finds no live cart is stale.
      const stale: CookieEffect = owner.guestToken === undefined ? keep : { _tag: "Clear" };
      if (!create) return { value: undefined, cookie: stale };

      const token = OpaqueToken.create(CartToken.schema);
      const expiresAt = Clock.after(clock, deps.guestCartTtlSeconds);
      const cartId = await repository.createForGuest(token.digest, expiresAt);

      return { value: cartId, cookie: { _tag: "Set", token: token.plaintext, expiresAt } };
    };

    const viewOf = (cartId: CartId | undefined): Promise<CartView> =>
      cartId === undefined ? Promise.resolve(CartRepository.EMPTY) : repository.view(cartId);

    /**
     * Writes the quantity `decide` allows to the line. The checks run against
     * the cart as it stands, so a refused change creates no cart.
     */
    const change = (
      owner: CartOwner,
      productId: ProductId,
      decide: (current: number, stock: number) => QuantityCheck,
    ): ResultAsync<CartOutcome<CartView>, DomainError> => {
      const run = async (): Promise<Result<CartOutcome<CartView>, DomainError>> => {
        const product = await repository.findProduct(productId);
        if (product === undefined) return err({ _tag: "ProductNotFound" });

        const existing = await resolve(owner, false);
        const current = existing.value === undefined ? 0 : await repository.quantityOf(existing.value, productId);
        const decision = decide(current, product.stock);

        if (decision._tag === "Short") {
          return err({ _tag: "OutOfStock", issues: [{ path: productId, message: decision.message }] });
        }

        const resolved = await resolve(owner, true);
        if (resolved.value === undefined) return err({ _tag: "Conflict" });

        await repository.setQuantity(resolved.value, productId, decision.quantity);

        return ok({ value: await repository.view(resolved.value), cookie: resolved.cookie });
      };

      return new ResultAsync(run());
    };

    return {
      view: async (owner) => {
        const resolved = await resolve(owner, false);
        return { value: await viewOf(resolved.value), cookie: resolved.cookie };
      },

      add: (owner, productId, quantity) =>
        change(owner, productId, (current, stock) => Cart.add(current, quantity, stock)),

      setQuantity: (owner, productId, quantity) =>
        change(owner, productId, (_current, stock) => Cart.set(quantity, stock)),

      remove: async (owner, productId) => {
        const resolved = await resolve(owner, false);
        if (resolved.value !== undefined) await repository.removeItem(resolved.value, productId);

        return { value: await viewOf(resolved.value), cookie: resolved.cookie };
      },

      recommendations: async (owner) => {
        const resolved = await resolve(owner, false);
        const view = await viewOf(resolved.value);
        const items = await deps.catalog.related(
          view.lines.map((line) => line.productId),
          CartService.RECOMMENDATIONS,
        );

        return { value: items, cookie: resolved.cookie };
      },

      locate: (owner) => resolve(owner, false),
    };
  },
} as const;
