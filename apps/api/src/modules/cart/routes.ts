/**
 * HTTP surface for the cart. Every route serves guests and signed-in users
 * alike; a guest's cart is found by its cookie.
 */

import { AddToCartInput, ProductId, SetQuantityInput } from "@prism/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Cookies, type CookieOptions } from "../../http/cookies.ts";
import { HttpErrors } from "../../http/errors.ts";
import type { Guards } from "../../http/guard.ts";
import { CartToken } from "../../platform/tokens.ts";
import type { CartOutcome, CartOwner, CartService, CookieEffect } from "./service.ts";

/** What the cart routes are served from. */
export type CartRouteDependencies = Readonly<{
  service: CartService;
  guards: Guards;
  cookies: CookieOptions;
}>;

export const CartRoutes = {
  /** The user the guard found, and the guest cookie the browser sent. */
  ownerOf: (request: FastifyRequest): CartOwner => {
    const guest = CartToken.schema.safeParse(request.cookies[Cookies.CART]);

    return {
      ...(request.authenticated === undefined ? {} : { userId: request.authenticated.id }),
      ...(guest.success ? { guestToken: guest.data } : {}),
    };
  },

  /** Sets or clears the guest cookie as `effect` says. */
  applyCookie: (reply: FastifyReply, effect: CookieEffect, cookies: CookieOptions): void => {
    if (effect._tag === "Set") Cookies.setCart(reply, effect.token, effect.expiresAt, cookies);
    if (effect._tag === "Clear") Cookies.clearCart(reply, cookies);
  },

  /** Applies the outcome's cookie effect and sends its value. */
  send: <T>(reply: FastifyReply, outcome: CartOutcome<T>, cookies: CookieOptions): FastifyReply => {
    CartRoutes.applyCookie(reply, outcome.cookie, cookies);
    return reply.status(200).send(outcome.value);
  },

  /** Mounts every cart endpoint. */
  register: (app: FastifyInstance, deps: CartRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, cookies } = deps;
    const optional = { preHandler: deps.guards.optionalUser };
    const productParams = z.object({ productId: ProductId.schema });

    routes.get("/cart", optional, async (request, reply) =>
      CartRoutes.send(reply, await service.view(CartRoutes.ownerOf(request)), cookies),
    );

    routes.post("/cart/items", { ...optional, schema: { body: AddToCartInput.schema } }, async (request, reply) => {
      const result = await service.add(CartRoutes.ownerOf(request), request.body.productId, request.body.quantity);
      return result.isErr() ? HttpErrors.send(reply, result.error) : CartRoutes.send(reply, result.value, cookies);
    });

    routes.put(
      "/cart/items/:productId",
      { ...optional, schema: { params: productParams, body: SetQuantityInput.schema } },
      async (request, reply) => {
        const result = await service.setQuantity(
          CartRoutes.ownerOf(request),
          request.params.productId,
          request.body.quantity,
        );
        return result.isErr() ? HttpErrors.send(reply, result.error) : CartRoutes.send(reply, result.value, cookies);
      },
    );

    routes.delete("/cart/items/:productId", { ...optional, schema: { params: productParams } }, async (request, reply) =>
      CartRoutes.send(reply, await service.remove(CartRoutes.ownerOf(request), request.params.productId), cookies),
    );

    routes.get("/cart/recommendations", optional, async (request, reply) => {
      const outcome = await service.recommendations(CartRoutes.ownerOf(request));
      return CartRoutes.send(reply, { value: { items: outcome.value }, cookie: outcome.cookie }, cookies);
    });
  },
} as const;
