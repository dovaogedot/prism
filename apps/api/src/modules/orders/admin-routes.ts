/** HTTP surface of orders and delivery options in the admin, under `/admin`. */

import { AdminOrderQuery, OrderId, OrderStatusChange, ShippingMethodCode, ShippingMethodInput } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import type { OrderService } from "./service.ts";
import type { ShippingMethods } from "./shipping.ts";

/** What the order admin routes are served from. */
export type OrderAdminRouteDependencies = Readonly<{
  service: OrderService;
  shipping: ShippingMethods;
  guards: Guards;
}>;

export const OrderAdminRoutes = {
  /** Mounts every order and delivery-option route of the admin. */
  register: (app: FastifyInstance, deps: OrderAdminRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, shipping, guards } = deps;
    const orderParams = z.object({ id: OrderId.schema });
    const methodParams = z.object({ code: ShippingMethodCode.schema });

    routes.get("/orders", { ...guards.admin("orders.view"), schema: { querystring: AdminOrderQuery.schema } }, async (request) =>
      service.adminList(request.query),
    );

    routes.get("/orders/:id", { ...guards.admin("orders.view"), schema: { params: orderParams } }, async (request, reply) =>
      HttpErrors.answer(reply, service.adminDetail(request.params.id)),
    );

    routes.post(
      "/orders/:id/status",
      { ...guards.admin("orders.fulfill", "staff-write"), schema: { params: orderParams, body: OrderStatusChange.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.advance(actor, request.params.id, request.body));
      },
    );

    routes.post(
      "/orders/:id/cancel",
      { ...guards.admin("orders.refund", "staff-write"), schema: { params: orderParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.cancelByStaff(actor, request.params.id));
      },
    );

    routes.post(
      "/orders/:id/refund",
      { ...guards.admin("orders.refund", "staff-write"), schema: { params: orderParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.refund(actor, request.params.id));
      },
    );

    routes.get("/shipping-methods", guards.admin("delivery.manage"), async () => ({ items: await shipping.all() }));

    routes.post(
      "/shipping-methods",
      { ...guards.admin("delivery.manage", "staff-write"), schema: { body: ShippingMethodInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await shipping.create(actor, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.put(
      "/shipping-methods/:code",
      { ...guards.admin("delivery.manage", "staff-write"), schema: { params: methodParams, body: ShippingMethodInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, shipping.update(actor, request.params.code, request.body));
      },
    );

    routes.delete(
      "/shipping-methods/:code",
      { ...guards.admin("delivery.manage", "staff-write"), schema: { params: methodParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await shipping.remove(actor, request.params.code);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );
  },
} as const;
