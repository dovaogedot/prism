/** HTTP surface for the catalog. Every endpoint is public, read-only and the same for every reader. */

import { ProductQuery, ProductQueryParams, Slug, SuggestParams } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import type { CatalogRepository } from "./repository.ts";

/** What the catalog routes are served from. */
export type CatalogRouteDependencies = Readonly<{ repository: CatalogRepository }>;

export const CatalogRoutes = {
  /** How many products the product page offers beside the one it shows. */
  RELATED: 8,

  /** Mounts every catalog endpoint. */
  register: (app: FastifyInstance, deps: CatalogRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const shared = { cache: "public" } as const;
    const slugParams = z.object({ slug: Slug.schema });

    routes.get("/home", { config: shared }, async () => deps.repository.home());

    routes.get("/categories", { config: shared }, async () => ({ items: await deps.repository.categories() }));

    routes.get("/products", { config: shared, schema: { querystring: ProductQueryParams.schema } }, async (request) =>
      deps.repository.search(ProductQuery.fromParams(request.query)),
    );

    routes.get(
      "/products/suggest",
      { config: { ...shared, rateLimit: "suggest" }, schema: { querystring: SuggestParams.schema } },
      async (request) => ({ items: await deps.repository.suggest(request.query.q, request.query.limit) }),
    );

    routes.get("/products/:slug", { config: shared, schema: { params: slugParams } }, async (request, reply) => {
      const product = await deps.repository.findBySlug(request.params.slug);

      return product === undefined ? HttpErrors.send(reply, { _tag: "ProductNotFound" }) : product;
    });

    routes.get("/products/:slug/related", { config: shared, schema: { params: slugParams } }, async (request) => ({
      items: await deps.repository.sameCategory(request.params.slug, CatalogRoutes.RELATED),
    }));
  },
} as const;
