/** HTTP surface for the catalog. Every endpoint is public and read-only. */

import { ProductQuery, ProductQueryParams, Slug, SuggestParams } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import type { CatalogRepository } from "./repository.ts";

/** What the catalog routes are served from. */
export type CatalogRouteDependencies = Readonly<{ repository: CatalogRepository }>;

export const CatalogRoutes = {
  /** Mounts every catalog endpoint. */
  register: (app: FastifyInstance, deps: CatalogRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();

    routes.get("/products", { schema: { querystring: ProductQueryParams.schema } }, async (request) =>
      deps.repository.search(ProductQuery.fromParams(request.query)),
    );

    routes.get("/products/suggest", { schema: { querystring: SuggestParams.schema } }, async (request) => ({
      items: await deps.repository.suggest(request.query.q, request.query.limit),
    }));

    routes.get(
      "/products/:slug",
      { schema: { params: z.object({ slug: Slug.schema }) } },
      async (request, reply) => {
        const product = await deps.repository.findBySlug(request.params.slug);

        return product === undefined ? HttpErrors.send(reply, { _tag: "ProductNotFound" }) : product;
      },
    );
  },
} as const;
