/**
 * HTTP surface for the catalogue.
 *
 * The read endpoints are public and cacheable; the one write endpoint is
 * behind the admin guard.
 */

import {
  productQueryParamsSchema,
  suggestQueryParamsSchema,
  toProductQuery,
} from "@hue/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { sendDomainError } from "../../http/errors.ts";
import type { createGuards } from "../../http/guard.ts";
import type { CatalogService } from "./service.ts";

export type CatalogRouteDependencies = Readonly<{
  service: CatalogService;
  guards: ReturnType<typeof createGuards>;
  /** Matches the in-process facet cache, so the two never disagree. */
  publicCacheSeconds: number;
  maxImageBytes: number;
}>;

const slugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Not a valid slug.")
    .max(120),
});

export const registerCatalogRoutes = (
  app: FastifyInstance,
  deps: CatalogRouteDependencies,
): void => {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { service, guards } = deps;

  const publicCacheHeader = `public, max-age=${deps.publicCacheSeconds}`;

  routes.get(
    "/categories",
    {
      schema: {
        tags: ["catalogue"],
        summary: "The category tree, with a product count for each subtree.",
      },
    },
    async (_request, reply) => {
      const result = await service.categories();

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.header("cache-control", publicCacheHeader).send(result.value);
    },
  );

  routes.get(
    "/products",
    {
      schema: {
        tags: ["catalogue"],
        summary:
          "Search, filter, sort and page the catalogue. Returns facet counts alongside the results.",
        querystring: productQueryParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await service.search(toProductQuery(request.query));

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.header("cache-control", publicCacheHeader).send(result.value);
    },
  );

  routes.get(
    "/products/suggest",
    {
      schema: {
        tags: ["catalogue"],
        summary: "Typeahead suggestions for the search box.",
        querystring: suggestQueryParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await service.suggest(request.query.q, request.query.limit);

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.header("cache-control", "no-store").send(result.value);
    },
  );

  routes.get(
    "/products/:slug",
    {
      schema: {
        tags: ["catalogue"],
        summary: "One colour, with its measurements in both unit systems.",
        params: slugParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await service.detail(request.params.slug);

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.header("cache-control", publicCacheHeader).send(result.value);
    },
  );

  /* ------------------------------------------------------------------ admin */

  routes.post(
    "/admin/products/:slug/images",
    {
      preHandler: guards.requireAdmin,
      schema: {
        tags: ["catalogue"],
        summary:
          "Upload a swatch image. The file type is decided by its magic bytes, not its name.",
        params: slugParamsSchema,
        consumes: ["multipart/form-data"],
      },
    },
    async (request, reply) => {
      const upload = await request.file({
        limits: { fileSize: deps.maxImageBytes, files: 1 },
      });

      if (upload === undefined) {
        return sendDomainError(reply, {
          _tag: "ValidationFailed",
          issues: [{ path: "file", message: "Attach an image file." }],
        });
      }

      const bytes = await upload.toBuffer();

      // @fastify/multipart truncates at the limit rather than rejecting, so the
      // flag has to be checked explicitly or an oversized upload is silently
      // stored as a corrupt half-image.
      if (upload.file.truncated) {
        return sendDomainError(reply, { _tag: "ImageTooLarge" });
      }

      const alt =
        typeof upload.fields["alt"] === "object" &&
        upload.fields["alt"] !== null &&
        "value" in upload.fields["alt"] &&
        typeof upload.fields["alt"].value === "string"
          ? upload.fields["alt"].value.slice(0, 200)
          : "";

      const result = await service.attachImage({
        slug: request.params.slug,
        bytes,
        alt,
      });

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(201).send(result.value);
    },
  );

};

/**
 * Images are served from the root, not from under `/api/v1`, because the URLs
 * embedded in catalogue responses are `/media/<sha256>.png` and the reverse
 * proxy routes `/media/*` here directly.
 */
export const registerMediaRoutes = (app: FastifyInstance): void => {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/media/:filename",
    {
      schema: {
        tags: ["catalogue"],
        summary: "Serve a stored swatch image.",
        params: z.object({
          // Only names `save` could have produced. Path traversal never reaches
          // the filesystem, because `../` does not match this pattern.
          filename: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp)$/),
        }),
      },
    },
    async (request, reply) =>
      reply
        .header("cache-control", "public, max-age=31536000, immutable")
        .sendFile(request.params.filename),
  );
};
