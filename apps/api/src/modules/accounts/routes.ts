/** HTTP surface of a customer's own account: the profile and the saved addresses. */

import { AddressId, ProfileInput, SavedAddressInput } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import type { Guards } from "../../http/guard.ts";
import type { AccountService } from "./service.ts";

/** What the account routes are served from. */
export type AccountRouteDependencies = Readonly<{ service: AccountService; guards: Guards }>;

export const AccountRoutes = {
  /** Mounts every account endpoint. Each acts on the caller's own account and nobody else's. */
  register: (app: FastifyInstance, deps: AccountRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const write = { rateLimit: "member-write" } as const;
    const params = z.object({ id: AddressId.schema });

    routes.get("/account/profile", { preHandler: guards.requireUser }, async (request, reply) => {
      if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });
      return HttpErrors.answer(reply, service.profile(request.authenticated.id));
    });

    routes.put(
      "/account/profile",
      { preHandler: guards.requireUser, config: write, schema: { body: ProfileInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });
        return HttpErrors.answer(reply, service.updateProfile(request.authenticated.id, request.body));
      },
    );

    routes.get("/account/addresses", { preHandler: guards.requireUser }, async (request, reply) => {
      if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });
      return { items: await service.addresses(request.authenticated.id) };
    });

    routes.post(
      "/account/addresses",
      { preHandler: guards.requireUser, config: write, schema: { body: SavedAddressInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.addAddress(request.authenticated.id, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.put(
      "/account/addresses/:id",
      { preHandler: guards.requireUser, config: write, schema: { params, body: SavedAddressInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });
        return HttpErrors.answer(reply, service.updateAddress(request.authenticated.id, request.params.id, request.body));
      },
    );

    routes.delete(
      "/account/addresses/:id",
      { preHandler: guards.requireUser, config: write, schema: { params } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.removeAddress(request.authenticated.id, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );
  },
} as const;
