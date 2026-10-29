/**
 * HTTP surface of reviews. Reading is public and the same for everyone, so
 * a cache may keep it; what the reader wrote and voted for comes from its
 * own private endpoint.
 */

import { ReviewId, ReviewInput, ReviewQueryParams, Slug } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import type { ReviewService } from "./service.ts";

/** What the review routes are served from. */
export type ReviewRouteDependencies = Readonly<{ service: ReviewService; guards: Guards }>;

export const ReviewRoutes = {
  /** Mounts every public and member review endpoint. */
  register: (app: FastifyInstance, deps: ReviewRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const productParams = z.object({ slug: Slug.schema });
    const reviewParams = z.object({ id: ReviewId.schema });
    const write = { rateLimit: "member-write" } as const;

    routes.get(
      "/products/:slug/reviews",
      { config: { cache: "public" }, schema: { params: productParams, querystring: ReviewQueryParams.schema } },
      async (request, reply) => {
        const result = await service.published(request.params.slug, request.query);
        return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
      },
    );

    routes.get(
      "/products/:slug/reviews/viewer",
      { onRequest: guards.requireUser, schema: { params: productParams } },
      async (request, reply) => {
        const result = await service.viewer(request.params.slug, Guards.userOf(request).id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
      },
    );

    routes.put(
      "/products/:slug/reviews/mine",
      { onRequest: guards.requireUser, config: write, schema: { params: productParams, body: ReviewInput.schema } },
      async (request, reply) => {
        const result = await service.saveOwn(request.params.slug, Guards.userOf(request).id, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : result.value;
      },
    );

    routes.delete(
      "/products/:slug/reviews/mine",
      { onRequest: guards.requireUser, config: write, schema: { params: productParams } },
      async (request, reply) => {
        const result = await service.deleteOwn(request.params.slug, Guards.userOf(request).id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.put(
      "/reviews/:id/vote",
      { onRequest: guards.requireUser, config: write, schema: { params: reviewParams } },
      async (request, reply) => {
        const result = await service.vote(request.params.id, Guards.userOf(request).id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.delete(
      "/reviews/:id/vote",
      { onRequest: guards.requireUser, config: write, schema: { params: reviewParams } },
      async (request, reply) => {
        const result = await service.unvote(request.params.id, Guards.userOf(request).id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );
  },
} as const;
