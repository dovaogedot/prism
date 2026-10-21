/** HTTP surface of the moderation queue in the admin, under `/admin`. */

import { AdminReviewQuery, RejectReviewInput, ReviewId } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import type { ReviewService } from "./service.ts";

/** What the moderation routes are served from. */
export type ReviewAdminRouteDependencies = Readonly<{ service: ReviewService; guards: Guards }>;

export const ReviewAdminRoutes = {
  /** Mounts the moderation queue and its decisions. */
  register: (app: FastifyInstance, deps: ReviewAdminRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const params = z.object({ id: ReviewId.schema });

    routes.get("/reviews", { ...guards.admin("reviews.moderate"), schema: { querystring: AdminReviewQuery.schema } }, async (request) =>
      service.queue(request.query),
    );

    routes.post(
      "/reviews/:id/approve",
      { ...guards.admin("reviews.moderate", "staff-write"), schema: { params } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.moderate(actor, request.params.id, { _tag: "approve" });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.post(
      "/reviews/:id/reject",
      { ...guards.admin("reviews.moderate", "staff-write"), schema: { params, body: RejectReviewInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.moderate(actor, request.params.id, { _tag: "reject", reason: request.body.reason });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.delete(
      "/reviews/:id",
      { ...guards.admin("reviews.moderate", "staff-write"), schema: { params } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.remove(actor, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );
  },
} as const;
