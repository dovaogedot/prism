/** HTTP surface of the catalog in the admin, under `/admin`. */

import {
  AdminProductQuery,
  BrandId,
  BrandInput,
  CategoryId,
  CategoryInput,
  ImageAlt,
  ImageId,
  ImageOrderInput,
  ProductId,
  ProductInput,
} from "@prism/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import type { CatalogAdminService, ImageUpload, ImportUpload } from "./admin-service.ts";
import { ImportFile } from "./import.ts";

/** What the catalog admin routes are served from. */
export type CatalogAdminRouteDependencies = Readonly<{ service: CatalogAdminService; guards: Guards }>;

/** What reading an upload found. */
type UploadRead =
  | Readonly<{ _tag: "Read"; upload: ImageUpload }>
  | Readonly<{ _tag: "TooLarge" }>
  | Readonly<{ _tag: "Invalid"; path: string; message: string }>;

/** What reading an import file found. */
type ImportRead =
  | Readonly<{ _tag: "Read"; file: ImportUpload }>
  | Readonly<{ _tag: "TooLarge" }>
  | Readonly<{ _tag: "Invalid" }>;

export const CatalogAdminRoutes = {
  /** The import file of a multipart body: its one `file` part, as text. */
  readImport: async (request: FastifyRequest): Promise<ImportRead> => {
    try {
      const part = await request.file({ limits: { fileSize: ImportFile.MAX_BYTES, files: 1 } });
      if (part === undefined) return { _tag: "Invalid" };

      const bytes = await part.toBuffer();
      return { _tag: "Read", file: { filename: part.filename, mimetype: part.mimetype, text: bytes.toString("utf8") } };
    } catch (reason) {
      if (reason instanceof request.server.multipartErrors.RequestFileTooLargeError) return { _tag: "TooLarge" };
      return { _tag: "Invalid" };
    }
  },

  /** The largest picture file accepted. */
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,

  /**
   * The picture and its fields from a multipart body: a `file` part, an
   * `alt` text and an `isPixelArt` of `true` or `false`.
   */
  readUpload: async (request: FastifyRequest): Promise<UploadRead> => {
    const fields: Record<string, string> = {};
    let bytes: Buffer | undefined;

    try {
      for await (const part of request.parts({ limits: { fileSize: CatalogAdminRoutes.MAX_IMAGE_BYTES, files: 1 } })) {
        if (part.type === "file") bytes = await part.toBuffer();
        else if (typeof part.value === "string") fields[part.fieldname] = part.value;
      }
    } catch (reason) {
      if (reason instanceof request.server.multipartErrors.RequestFileTooLargeError) return { _tag: "TooLarge" };
      return { _tag: "Invalid", path: "file", message: "Send the picture as multipart/form-data with a file part." };
    }

    if (bytes === undefined) return { _tag: "Invalid", path: "file", message: "Choose a picture to upload." };

    const alt = ImageAlt.schema.safeParse(fields["alt"]);
    if (!alt.success) return { _tag: "Invalid", path: "alt", message: alt.error.issues[0]?.message ?? "Describe the picture." };

    return { _tag: "Read", upload: { bytes, alt: alt.data, isPixelArt: fields["isPixelArt"] === "true" } };
  },

  /** Mounts every catalog route of the admin. */
  register: (app: FastifyInstance, deps: CatalogAdminRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards } = deps;
    const productParams = z.object({ id: ProductId.schema });
    const categoryParams = z.object({ id: CategoryId.schema });
    const brandParams = z.object({ id: BrandId.schema });

    routes.get("/products", { ...guards.admin("catalog.manage"), schema: { querystring: AdminProductQuery.schema } }, async (request) =>
      service.listProducts(request.query),
    );

    routes.post(
      "/products",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { body: ProductInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.createProduct(actor, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.post(
      "/products/import",
      {
        ...guards.admin("catalog.import", "import"),
        schema: { querystring: z.object({ dryRun: z.stringbool().default(false) }) },
      },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const read = await CatalogAdminRoutes.readImport(request);
        if (read._tag === "TooLarge") return HttpErrors.send(reply, { _tag: "PayloadTooLarge" });
        if (read._tag === "Invalid") {
          return HttpErrors.send(reply, {
            _tag: "ValidationFailed",
            issues: [{ path: "file", message: "Send one JSON or CSV file as multipart/form-data." }],
          });
        }

        return HttpErrors.answer(reply, service.importFile(actor, read.file, request.query.dryRun));
      },
    );

    routes.get("/products/:id", { ...guards.admin("catalog.manage"), schema: { params: productParams } }, async (request, reply) =>
      HttpErrors.answer(reply, service.product(request.params.id)),
    );

    routes.put(
      "/products/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: productParams, body: ProductInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.updateProduct(actor, request.params.id, request.body));
      },
    );

    routes.delete(
      "/products/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: productParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.deleteProduct(actor, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.get("/categories", guards.admin("catalog.manage"), async () => ({ items: await service.categories() }));

    routes.post(
      "/categories",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { body: CategoryInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.saveCategory(actor, undefined, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.put(
      "/categories/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: categoryParams, body: CategoryInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.saveCategory(actor, request.params.id, request.body));
      },
    );

    routes.delete(
      "/categories/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: categoryParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.deleteCategory(actor, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.get("/brands", guards.admin("catalog.manage"), async () => ({ items: await service.brands() }));

    routes.post(
      "/brands",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { body: BrandInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.saveBrand(actor, undefined, request.body);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send(result.value);
      },
    );

    routes.put(
      "/brands/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: brandParams, body: BrandInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(reply, service.saveBrand(actor, request.params.id, request.body));
      },
    );

    routes.delete(
      "/brands/:id",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: brandParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.deleteBrand(actor, request.params.id);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(204).send();
      },
    );

    routes.get("/products/:id/images", { ...guards.admin("catalog.manage"), schema: { params: productParams } }, async (request, reply) =>
      HttpErrors.answer(reply, service.images(request.params.id).map((images) => ({ images }))),
    );

    routes.post(
      "/products/:id/images",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: productParams } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const read = await CatalogAdminRoutes.readUpload(request);
        if (read._tag === "TooLarge") return HttpErrors.send(reply, { _tag: "PayloadTooLarge" });
        if (read._tag === "Invalid") {
          return HttpErrors.send(reply, { _tag: "ValidationFailed", issues: [{ path: read.path, message: read.message }] });
        }

        const result = await service.addImage(actor, request.params.id, read.upload);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(201).send({ images: result.value });
      },
    );

    routes.put(
      "/products/:id/images",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: productParams, body: ImageOrderInput.schema } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(
          reply,
          service.reorderImages(actor, request.params.id, request.body.images).map((images) => ({ images })),
        );
      },
    );

    routes.delete(
      "/products/:id/images/:imageId",
      { ...guards.admin("catalog.manage", "staff-write"), schema: { params: z.object({ id: ProductId.schema, imageId: ImageId.schema }) } },
      async (request, reply) => {
        const actor = Guards.actorOf(request);
        if (actor === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        return HttpErrors.answer(
          reply,
          service.removeImage(actor, request.params.id, request.params.imageId).map((images) => ({ images })),
        );
      },
    );
  },
} as const;
