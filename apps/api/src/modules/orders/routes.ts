/**
 * HTTP surface for checkout and orders. A guest reaches their order with the
 * key from its confirmation link; a signed-in customer reaches their own.
 */

import {
  OrderId,
  OrderKey,
  OrderQueryParams,
  PlaceOrderInput,
  ShippingAddress,
  type PaymentsConfig,
} from "@prism/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { CookieOptions } from "../../http/cookies.ts";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import { CartRoutes } from "../cart/routes.ts";
import type { CartService } from "../cart/service.ts";
import type { OrderAccess, OrderService } from "./service.ts";
import type { ShippingMethods } from "./shipping.ts";

/** What the order routes are served from. */
export type OrderRouteDependencies = Readonly<{
  service: OrderService;
  carts: CartService;
  shipping: ShippingMethods;
  guards: Guards;
  cookies: CookieOptions;
  payments: PaymentsConfig;
}>;

export const OrderRoutes = {
  accessOf: (request: FastifyRequest, key: OrderKey | undefined): OrderAccess => ({
    ...(request.authenticated === undefined ? {} : { userId: request.authenticated.id }),
    ...(key === undefined ? {} : { key }),
  }),

  /** Mounts every checkout and order endpoint. */
  register: (app: FastifyInstance, deps: OrderRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const limited = { rateLimit: "checkout" } as const;
    const orderParams = z.object({ id: OrderId.schema });
    const keyQuery = z.object({ key: OrderKey.schema.optional() });

    routes.get("/checkout/config", async () => deps.payments);

    routes.get("/shipping-methods", { config: { cache: "public" } }, async () => ({ items: await deps.shipping.listActive() }));

    routes.get("/checkout/prefill", { onRequest: guards.requireUser }, async (request, reply) => {
      const result = await service.prefill(Guards.userOf(request).id);
      return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
    });

    routes.post("/checkout/address", { config: limited, schema: { body: ShippingAddress.schema } }, async (request) =>
      service.verifyAddress(request.body),
    );

    routes.post(
      "/orders",
      { onRequest: guards.optionalUser, config: limited, schema: { body: PlaceOrderInput.schema } },
      async (request, reply) => {
        const located = await deps.carts.locate(CartRoutes.ownerOf(request));
        const result = await service.place({
          ...(located.value === undefined ? {} : { cartId: located.value }),
          ...(request.authenticated === undefined ? {} : { userId: request.authenticated.id }),
          body: request.body,
        });

        // Merging a guest cart on the way spends its cookie, whatever the answer.
        CartRoutes.applyCookie(reply, located.cookie, deps.cookies);

        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.get("/orders", { onRequest: guards.requireUser, schema: { querystring: OrderQueryParams.schema } }, async (request, reply) => {
      return service.list(Guards.userOf(request).id, request.query);
    });

    routes.get(
      "/orders/:id",
      { onRequest: guards.optionalUser, schema: { params: orderParams, querystring: keyQuery } },
      async (request, reply) => {
        const result = await service.detail(request.params.id, OrderRoutes.accessOf(request, request.query.key));
        return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
      },
    );

    routes.post(
      "/orders/:id/cancel",
      { onRequest: guards.optionalUser, schema: { params: orderParams, querystring: keyQuery } },
      async (request, reply) => {
        const result = await service.cancel(request.params.id, OrderRoutes.accessOf(request, request.query.key));
        return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
      },
    );
  },
} as const;
