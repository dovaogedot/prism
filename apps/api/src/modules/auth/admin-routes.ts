/** HTTP surface of the account pages of the admin, under `/admin`. */

import { AdminUserQuery, RoleChange, UserId } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import type { AccountAdminService } from "./admin-service.ts";

/** What the account admin routes are served from. */
export type AccountAdminRouteDependencies = Readonly<{ service: AccountAdminService; guards: Guards }>;

export const AccountAdminRoutes = {
  /** Mounts every account route of the admin. */
  register: (app: FastifyInstance, deps: AccountAdminRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const params = z.object({ id: UserId.schema });

    routes.get("/users", { ...guards.admin("customers.view"), schema: { querystring: AdminUserQuery.schema } }, async (request) =>
      service.list(request.query),
    );

    routes.get("/users/:id", { ...guards.admin("customers.view"), schema: { params } }, async (request, reply) =>
      HttpErrors.answer(reply, service.detail(request.params.id)),
    );

    routes.put(
      "/users/:id/roles",
      { ...guards.admin("staff.manage", "staff-write"), schema: { params, body: RoleChange.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.setRoles(actor, request.params.id, request.body.roles));
      },
    );

    const actions = {
      disable: service.disable,
      enable: service.enable,
      "reset-two-factor": service.resetTwoFactor,
      "sign-out": service.signOut,
    } as const;

    for (const [path, act] of Object.entries(actions)) {
      routes.post(
        `/users/:id/${path}`,
        { ...guards.admin("staff.manage", "staff-write"), schema: { params } },
        async (request, reply) => {
          const actor = Guards.actorOf(request);
          if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

          return HttpErrors.answer(reply, act(actor, request.params.id));
        },
      );
    }
  },
} as const;
