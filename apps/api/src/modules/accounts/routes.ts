/** HTTP surface of a customer's own account: the profile and the saved addresses. */

import { AddressId, ProfileInput, SavedAddressInput } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
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

    routes.get("/account/profile", { onRequest: guards.requireUser }, async (request, reply) => {
      return HttpErrors.answer(reply, service.profile(Guards.userOf(request).id));
    });

    routes.put(
      "/account/profile",
      { onRequest: guards.requireUser, config: write, schema: { body: ProfileInput.schema } },
      async (request, reply) => {
        return HttpErrors.answer(reply, service.updateProfile(Guards.userOf(request).id, request.body));
      },
    );

    routes.get("/account/addresses", { onRequest: guards.requireUser }, async (request) => {
      return { items: await service.addresses(Guards.userOf(request).id) };
    });

    routes.post(
      "/account/addresses",
      { onRequest: guards.requireUser, config: write, schema: { body: SavedAddressInput.schema } },
      async (request, reply) => {
        const result = await service.addAddress(Guards.userOf(request).id, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.put(
      "/account/addresses/:id",
      { onRequest: guards.requireUser, config: write, schema: { params, body: SavedAddressInput.schema } },
      async (request, reply) => {
        return HttpErrors.answer(reply, service.updateAddress(Guards.userOf(request).id, request.params.id, request.body));
      },
    );

    routes.delete(
      "/account/addresses/:id",
      { onRequest: guards.requireUser, config: write, schema: { params } },
      async (request, reply) => {
        const result = await service.removeAddress(Guards.userOf(request).id, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );
  },
} as const;
