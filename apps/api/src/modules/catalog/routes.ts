/**
 * HTTP surface for the catalog.
 *
 * The read endpoints are public and cacheable; the one write endpoint is
 * behind the admin guard.
 */

import {
  productQueryParamsSchema,
  suggestQueryParamsSchema,
  toProductQuery,
} from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { sendDomainError } from "../../http/errors.ts";
import type { createGuards } from "../../http/guard.ts";
import type { CatalogService } from "./service.ts";

/** What the catalog routes need beyond the service itself. */
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

/** Mounts every catalog endpoint, each carrying the schema its OpenAPI entry is generated from. */
export const registerCatalogRoutes = (
  app: FastifyInstance,
  deps: CatalogRouteDependencies,
): void => {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { service, guards } = deps;

  const publicCacheHeader = `public, max-age=${deps.publicCacheSeconds}`;

  routes.get(
    "/products",
    {
      schema: {
        tags: ["catalog"],
        summary:
          "Search, filter, sort and page the catalog. Returns facet counts alongside the results.",
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
        tags: ["catalog"],
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
        tags: ["catalog"],
        summary: "One color, with its measurements in both unit systems.",
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
        tags: ["catalog"],
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
 * embedded in catalog responses are `/media/<sha256>.png` and the reverse
 * proxy routes `/media/*` here directly.
 */
export const registerMediaRoutes = (app: FastifyInstance): void => {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/media/:filename",
    {
      schema: {
        tags: ["catalog"],
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
