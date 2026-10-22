/**
 * The statements behind the catalog pages of the admin. Every change writes
 * its audit entry in the same transaction.
 */

import {
  Page,
  type AdminBrand,
  type AdminCategory,
  type AdminProductDetail,
  type AdminProductQuery,
  type AdminProductSort,
  type AdminProductSummary,
  type BrandId,
  type BrandInput,
  type CategoryId,
  type CategoryInput,
  type ImageId,
  type ImportRow,
  type ProductId,
  type ProductImage,
  type ProductInput,
  type Slug,
} from "@prism/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, max, or, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "../../db/client.ts";
import { brands, categories, productImages, productProperties, products } from "../../db/schema.ts";
import type { StoredImage } from "../../platform/image-store.ts";
import { AuthRepository } from "../auth/repository.ts";
import { AuditLog, type StaffActor } from "../staff/audit.ts";
import { ImageRows, type ImageRow } from "./images.ts";
import type { ImportIssue } from "./import.ts";
import { ProductSearch } from "./search.ts";

/** What a create or an update of a product, category or brand found. */
export type SaveOutcome<T> =
  | Readonly<{ _tag: "Saved"; id: T }>
  | Readonly<{ _tag: "NotFound" }>
  | Readonly<{ _tag: "SlugTaken" }>
  /** The category or brand named does not exist. */
  | Readonly<{ _tag: "MissingReference"; field: "categoryId" | "brandId" }>;

/** What deleting a category or brand found. */
export type DeleteOutcome = Readonly<{ _tag: "Deleted" }> | Readonly<{ _tag: "NotFound" }> | Readonly<{ _tag: "InUse" }>;

/** What an import did, or what it found wrong with the rows. */
export type ImportOutcome =
  | Readonly<{ _tag: "Imported"; created: number; updated: number }>
  | Readonly<{ _tag: "Invalid"; issues: readonly ImportIssue[] }>;

/** What adding a picture found. */
export type AddImageOutcome =
  | Readonly<{ _tag: "Added" }>
  | Readonly<{ _tag: "ProductNotFound" }>
  | Readonly<{ _tag: "LimitReached" }>;

/** What reordering a product's pictures found. */
export type ReorderOutcome =
  | Readonly<{ _tag: "Reordered" }>
  | Readonly<{ _tag: "ProductNotFound" }>
  /** The list named other pictures than the product has. */
  | Readonly<{ _tag: "Mismatch" }>;

/** What removing a picture found: the file to delete once the row is gone. */
export type RemoveImageOutcome =
  | Readonly<{ _tag: "Removed"; image: Readonly<{ id: ImageId; file: string }> }>
  | Readonly<{ _tag: "ImageNotFound" }>;

/** Every read and write of the catalog pages. */
export type CatalogAdminRepository = Readonly<{
  listProducts: (query: AdminProductQuery) => Promise<Page<AdminProductSummary>>;
  product: (productId: ProductId) => Promise<AdminProductDetail | undefined>;
  createProduct: (input: ProductInput, actor: StaffActor, now: Date) => Promise<SaveOutcome<ProductId>>;
  updateProduct: (productId: ProductId, input: ProductInput, actor: StaffActor, now: Date) => Promise<SaveOutcome<ProductId>>;
  /** Deletes the product; resolves to its pictures, whose files go once the row has, or `undefined` when there is none. */
  deleteProduct: (productId: ProductId, actor: StaffActor) => Promise<readonly Readonly<{ id: ImageId; file: string }>[] | undefined>;
  categories: () => Promise<readonly AdminCategory[]>;
  saveCategory: (id: CategoryId | undefined, input: CategoryInput, actor: StaffActor) => Promise<SaveOutcome<CategoryId>>;
  deleteCategory: (id: CategoryId, actor: StaffActor) => Promise<DeleteOutcome>;
  brands: () => Promise<readonly AdminBrand[]>;
  saveBrand: (id: BrandId | undefined, input: BrandInput, actor: StaffActor) => Promise<SaveOutcome<BrandId>>;
  deleteBrand: (id: BrandId, actor: StaffActor) => Promise<DeleteOutcome>;
  /**
   * Checks the rows against the database: every category and brand must
   * exist. With `dryRun` it only counts; otherwise it writes every row, each
   * slug creating or updating its product, in one transaction.
   */
  importProducts: (rows: readonly Readonly<{ row: number; product: ImportRow }>[], dryRun: boolean, actor: StaffActor, now: Date) => Promise<ImportOutcome>;
  /** The product's pictures in order; `undefined` when there is no such product. */
  imagesOf: (productId: ProductId) => Promise<readonly ProductImage[] | undefined>;
  /** Files a stored picture as the product's last, unless the product already has the most it may. */
  addImage: (input: Readonly<{
    productId: ProductId;
    image: StoredImage;
    alt: string;
    isPixelArt: boolean;
    maxImages: number;
    actor: StaffActor;
  }>) => Promise<AddImageOutcome>;
  /** Puts the product's pictures in the given order, with the given texts. */
  reorderImages: (input: Readonly<{
    productId: ProductId;
    images: readonly Readonly<{ id: ImageId; alt: string }>[];
    actor: StaffActor;
  }>) => Promise<ReorderOutcome>;
  removeImage: (input: Readonly<{ productId: ProductId; imageId: ImageId; actor: StaffActor }>) => Promise<RemoveImageOutcome>;
}>;

export const CatalogAdminRepository = {
  /** The fields of a product an audit entry compares. The description is long, so only whether it changed is kept. */
  auditedOf: (input: ProductInput) => ({
    name: input.name,
    slug: input.slug,
    descriptionLength: input.description.length,
    priceCents: input.priceCents,
    stock: input.stock,
    categoryId: input.categoryId,
    brandId: input.brandId,
    weightGrams: input.weightGrams,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    depthMm: input.depthMm,
    properties: input.properties.map((property) => `${property.name}: ${property.value}`),
    isFeatured: input.isFeatured,
  }),

  /** Products that are featured, or that are not. */
  featuredCondition: (isFeatured: boolean): SQL => (isFeatured ? isNotNull(products.featuredAt) : isNull(products.featuredAt)),

  /** The constraint a Postgres error names, read one level down from drizzle's wrapper. */
  constraintOf: (reason: unknown): string | undefined => {
    const own = (value: unknown): string | undefined =>
      typeof value === "object" && value !== null && "constraint_name" in value && typeof value.constraint_name === "string"
        ? value.constraint_name
        : undefined;

    return own(reason) ?? (typeof reason === "object" && reason !== null && "cause" in reason ? own(reason.cause) : undefined);
  },

  create: (db: Database, audit: AuditLog): CatalogAdminRepository => {
    const imageColumns = {
      id: productImages.id,
      file: productImages.file,
      alt: productImages.alt,
      width: productImages.width,
      height: productImages.height,
      isPixelArt: productImages.isPixelArt,
    };

    const writeProperties = async (tx: Transaction, productId: ProductId, properties: ProductInput["properties"]) => {
      await tx.delete(productProperties).where(eq(productProperties.productId, productId));
      if (properties.length > 0) {
        await tx.insert(productProperties).values(properties.map((property) => ({ productId, ...property })));
      }
    };

    /** A product's columns as an input writes them; featuring keeps the instant it began. */
    const columnsOf = (input: ProductInput, featuredAt: Date | null, now: Date) => ({
      slug: input.slug,
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      stock: input.stock,
      categoryId: input.categoryId,
      brandId: input.brandId,
      weightGrams: input.weightGrams,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      depthMm: input.depthMm,
      featuredAt: input.isFeatured ? (featuredAt ?? now) : null,
      updatedAt: now,
    });

    /** The outcome a failed product write stands for, or the failure itself when it is none of them. */
    const saveFailure = <T>(reason: unknown): SaveOutcome<T> => {
      if (AuthRepository.isUniqueViolation(reason)) return { _tag: "SlugTaken" };
      const constraint = CatalogAdminRepository.constraintOf(reason);
      if (constraint === "product_category_id_category_id_fk") return { _tag: "MissingReference", field: "categoryId" };
      if (constraint === "product_brand_id_brand_id_fk") return { _tag: "MissingReference", field: "brandId" };
      throw reason;
    };

    const product = async (productId: ProductId): Promise<AdminProductDetail | undefined> => {
      const [row] = await db.select().from(products).where(eq(products.id, productId));
      if (row === undefined) return undefined;

      const [properties, images] = await Promise.all([
        db
          .select({ name: productProperties.name, value: productProperties.value })
          .from(productProperties)
          .where(eq(productProperties.productId, productId))
          .orderBy(asc(productProperties.name)),
        db.select(imageColumns).from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position)),
      ]);

      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        priceCents: row.priceCents,
        stock: row.stock,
        categoryId: row.categoryId,
        brandId: row.brandId,
        weightGrams: row.weightGrams,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        depthMm: row.depthMm,
        properties,
        isFeatured: row.featuredAt !== null,
        images: images.map(ImageRows.view),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    };

    const productOrdering = {
      name_asc: [asc(products.name), asc(products.slug)],
      name_desc: [desc(products.name), desc(products.slug)],
      newest: [desc(products.createdAt), asc(products.slug)],
      oldest: [asc(products.createdAt), asc(products.slug)],
      stock_asc: [asc(products.stock), asc(products.slug)],
      stock_desc: [desc(products.stock), asc(products.slug)],
      price_asc: [asc(products.priceCents), asc(products.slug)],
      price_desc: [desc(products.priceCents), asc(products.slug)],
    } as const satisfies Record<AdminProductSort, readonly SQL[]>;

    const counted = <T extends { id: string }>(rows: readonly T[], used: readonly { id: string; total: number }[]) => {
      const counts = new Map(used.map((row) => [row.id, row.total]));
      return rows.map((row) => ({ ...row, productCount: counts.get(row.id) ?? 0 }));
    };

    return {
      listProducts: async (query) => {
        const pattern = query.q === undefined || query.q.length === 0 ? undefined : ProductSearch.likePattern(query.q);
        const conditions = and(
          pattern === undefined ? undefined : or(ilike(products.name, pattern), ilike(products.slug, pattern)),
          query.category === undefined ? undefined : eq(categories.slug, query.category),
          query.brand === undefined ? undefined : eq(brands.slug, query.brand),
          query.featured === undefined ? undefined : CatalogAdminRepository.featuredCondition(query.featured),
          query.lowStock === true ? lte(products.stock, 5) : undefined,
        );

        const [rows, totals] = await Promise.all([
          db
            .select({
              id: products.id,
              slug: products.slug,
              name: products.name,
              priceCents: products.priceCents,
              stock: products.stock,
              categorySlug: categories.slug,
              categoryName: categories.name,
              brandSlug: brands.slug,
              brandName: brands.name,
              featuredAt: products.featuredAt,
              updatedAt: products.updatedAt,
              image: sql<ImageRow | null>`(
                SELECT ${ImageRows.json("i")} FROM product_image i WHERE i.product_id = ${products.id} ORDER BY i.position LIMIT 1
              )`,
            })
            .from(products)
            .innerJoin(categories, eq(categories.id, products.categoryId))
            .innerJoin(brands, eq(brands.id, products.brandId))
            .where(conditions)
            .orderBy(...productOrdering[query.sort])
            .limit(query.perPage)
            .offset((query.page - 1) * query.perPage),
          db
            .select({ total: count() })
            .from(products)
            .innerJoin(categories, eq(categories.id, products.categoryId))
            .innerJoin(brands, eq(brands.id, products.brandId))
            .where(conditions),
        ]);
        const total = totals[0]?.total ?? 0;

        return {
          items: rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            priceCents: row.priceCents,
            stock: row.stock,
            category: { slug: row.categorySlug, name: row.categoryName },
            brand: { slug: row.brandSlug, name: row.brandName },
            isFeatured: row.featuredAt !== null,
            ...(row.image === null ? {} : { image: ImageRows.view(row.image) }),
            updatedAt: row.updatedAt.toISOString(),
          })),
          total,
          page: query.page,
          perPage: query.perPage,
          totalPages: Page.count(total, query.perPage),
        };
      },

      product,

      createProduct: (input, actor, now) =>
        db
          .transaction(async (tx): Promise<SaveOutcome<ProductId>> => {
            const [created] = await tx
              .insert(products)
              .values({ ...columnsOf(input, null, now), createdAt: now })
              .returning({ id: products.id });
            if (created === undefined) throw new Error("product insert returned no row");

            await writeProperties(tx, created.id, input.properties);
            await audit.record(tx, {
              actor,
              action: "product.create",
              target: { type: "product", id: created.id },
              summary: `Created the product ${input.name}`,
            });

            return { _tag: "Saved", id: created.id };
          })
          .catch(saveFailure<ProductId>),

      updateProduct: (productId, input, actor, now) =>
        db
          .transaction(async (tx): Promise<SaveOutcome<ProductId>> => {
            const [current] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
            if (current === undefined) return { _tag: "NotFound" };

            const before = await product(productId);
            await tx.update(products).set(columnsOf(input, current.featuredAt, now)).where(eq(products.id, productId));
            await writeProperties(tx, productId, input.properties);

            const changes = before === undefined ? undefined : AuditLog.diff(CatalogAdminRepository.auditedOf(before), CatalogAdminRepository.auditedOf(input));
            if (changes !== undefined) {
              await audit.record(tx, {
                actor,
                action: "product.update",
                target: { type: "product", id: productId },
                summary: `Edited the product ${input.name}`,
                changes,
              });
            }

            return { _tag: "Saved", id: productId };
          })
          .catch(saveFailure<ProductId>),

      deleteProduct: (productId, actor) =>
        db.transaction(async (tx) => {
          const images = await tx
            .select({ id: productImages.id, file: productImages.file })
            .from(productImages)
            .where(eq(productImages.productId, productId));
          // Order lines keep their copy of the name, slug and price; their link to the product is set to null.
          const [deleted] = await tx.delete(products).where(eq(products.id, productId)).returning({ name: products.name });
          if (deleted === undefined) return undefined;

          await audit.record(tx, {
            actor,
            action: "product.delete",
            target: { type: "product", id: productId },
            summary: `Deleted the product ${deleted.name}`,
          });

          return images;
        }),

      categories: async () => {
        const [rows, used] = await Promise.all([
          db.select().from(categories).orderBy(asc(categories.name)),
          db.select({ id: products.categoryId, total: count() }).from(products).groupBy(products.categoryId),
        ]);

        return counted(rows, used).map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          ...(row.description === null ? {} : { description: row.description }),
          productCount: row.productCount,
        }));
      },

      saveCategory: (id, input, actor) =>
        db
          .transaction(async (tx): Promise<SaveOutcome<CategoryId>> => {
            const values = { slug: input.slug, name: input.name, description: input.description ?? null };

            if (id === undefined) {
              const [created] = await tx.insert(categories).values(values).returning({ id: categories.id });
              if (created === undefined) throw new Error("category insert returned no row");
              await audit.record(tx, { actor, action: "category.create", target: { type: "category", id: created.id }, summary: `Created the category ${input.name}` });
              return { _tag: "Saved", id: created.id };
            }

            const [before] = await tx.select().from(categories).where(eq(categories.id, id)).for("update");
            if (before === undefined) return { _tag: "NotFound" };

            await tx.update(categories).set(values).where(eq(categories.id, id));
            const changes = AuditLog.diff({ slug: before.slug, name: before.name, description: before.description }, values);
            if (changes !== undefined) {
              await audit.record(tx, { actor, action: "category.update", target: { type: "category", id }, summary: `Edited the category ${input.name}`, changes });
            }
            return { _tag: "Saved", id };
          })
          .catch(saveFailure<CategoryId>),

      deleteCategory: (id, actor) =>
        db.transaction(async (tx): Promise<DeleteOutcome> => {
          const [used] = await tx.select({ total: count() }).from(products).where(eq(products.categoryId, id));
          if ((used?.total ?? 0) > 0) return { _tag: "InUse" };

          const [deleted] = await tx.delete(categories).where(eq(categories.id, id)).returning({ name: categories.name });
          if (deleted === undefined) return { _tag: "NotFound" };

          await audit.record(tx, { actor, action: "category.delete", target: { type: "category", id }, summary: `Deleted the category ${deleted.name}` });
          return { _tag: "Deleted" };
        }),

      brands: async () => {
        const [rows, used] = await Promise.all([
          db.select().from(brands).orderBy(asc(brands.name)),
          db.select({ id: products.brandId, total: count() }).from(products).groupBy(products.brandId),
        ]);

        return counted(rows, used).map((row) => ({ id: row.id, slug: row.slug, name: row.name, productCount: row.productCount }));
      },

      saveBrand: (id, input, actor) =>
        db
          .transaction(async (tx): Promise<SaveOutcome<BrandId>> => {
            const values = { slug: input.slug, name: input.name };

            if (id === undefined) {
              const [created] = await tx.insert(brands).values(values).returning({ id: brands.id });
              if (created === undefined) throw new Error("brand insert returned no row");
              await audit.record(tx, { actor, action: "brand.create", target: { type: "brand", id: created.id }, summary: `Created the brand ${input.name}` });
              return { _tag: "Saved", id: created.id };
            }

            const [before] = await tx.select().from(brands).where(eq(brands.id, id)).for("update");
            if (before === undefined) return { _tag: "NotFound" };

            await tx.update(brands).set(values).where(eq(brands.id, id));
            const changes = AuditLog.diff({ slug: before.slug, name: before.name }, values);
            if (changes !== undefined) {
              await audit.record(tx, { actor, action: "brand.update", target: { type: "brand", id }, summary: `Edited the brand ${input.name}`, changes });
            }
            return { _tag: "Saved", id };
          })
          .catch(saveFailure<BrandId>),

      deleteBrand: (id, actor) =>
        db.transaction(async (tx): Promise<DeleteOutcome> => {
          const [used] = await tx.select({ total: count() }).from(products).where(eq(products.brandId, id));
          if ((used?.total ?? 0) > 0) return { _tag: "InUse" };

          const [deleted] = await tx.delete(brands).where(eq(brands.id, id)).returning({ name: brands.name });
          if (deleted === undefined) return { _tag: "NotFound" };

          await audit.record(tx, { actor, action: "brand.delete", target: { type: "brand", id }, summary: `Deleted the brand ${deleted.name}` });
          return { _tag: "Deleted" };
        }),

      importProducts: async (rows, dryRun, actor, now) => {
        const slugsOf = (pick: (product: ImportRow) => Slug) => [...new Set(rows.map((entry) => pick(entry.product)))];
        const [categoryRows, brandRows, existing] = await Promise.all([
          rows.length === 0 ? [] : db.select({ id: categories.id, slug: categories.slug }).from(categories).where(inArray(categories.slug, slugsOf((product) => product.category))),
          rows.length === 0 ? [] : db.select({ id: brands.id, slug: brands.slug }).from(brands).where(inArray(brands.slug, slugsOf((product) => product.brand))),
          rows.length === 0 ? [] : db.select({ slug: products.slug }).from(products).where(inArray(products.slug, slugsOf((product) => product.slug))),
        ]);
        const categoryIds = new Map(categoryRows.map((row) => [row.slug, row.id]));
        const brandIds = new Map(brandRows.map((row) => [row.slug, row.id]));
        const known = new Set(existing.map((row) => row.slug));

        const issues: ImportIssue[] = [];
        for (const { row, product: candidate } of rows) {
          if (!categoryIds.has(candidate.category)) issues.push({ row, column: "category", message: "No category has this slug." });
          if (!brandIds.has(candidate.brand)) issues.push({ row, column: "brand", message: "No brand has this slug." });
        }
        if (issues.length > 0) return { _tag: "Invalid", issues };

        const updated = rows.filter((entry) => known.has(entry.product.slug)).length;
        const created = rows.length - updated;
        if (dryRun) return { _tag: "Imported", created, updated };

        await db.transaction(async (tx) => {
          for (const { product: candidate } of rows) {
            const categoryId = categoryIds.get(candidate.category);
            const brandId = brandIds.get(candidate.brand);
            if (categoryId === undefined || brandId === undefined) throw new Error("a checked reference vanished");

            const values = {
              slug: candidate.slug,
              name: candidate.name,
              description: candidate.description,
              priceCents: candidate.priceCents,
              stock: candidate.stock,
              categoryId,
              brandId,
              weightGrams: candidate.weightGrams,
              widthMm: candidate.widthMm,
              heightMm: candidate.heightMm,
              depthMm: candidate.depthMm,
              updatedAt: now,
            };

            const [saved] = await tx
              .insert(products)
              .values({ ...values, featuredAt: candidate.featured ? now : null, createdAt: now })
              .onConflictDoUpdate({
                target: products.slug,
                set: {
                  ...values,
                  // A product that stays featured keeps the instant it began.
                  featuredAt: candidate.featured ? sql`COALESCE(${products.featuredAt}, ${now.toISOString()}::timestamptz)` : null,
                },
              })
              .returning({ id: products.id });
            if (saved === undefined) throw new Error("product upsert returned no row");

            await writeProperties(tx, saved.id, candidate.properties);
          }

          await audit.record(tx, {
            actor,
            action: "product.import",
            target: { type: "product" },
            summary: `Imported ${rows.length === 1 ? "1 product" : `${rows.length} products`}: ${created} new, ${updated} updated`,
          });
        });

        return { _tag: "Imported", created, updated };
      },

      imagesOf: async (productId) => {
      const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
      if (product === undefined) return undefined;

      const rows = await db
        .select(imageColumns)
        .from(productImages)
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.position));

      return rows.map(ImageRows.view);
    },

    addImage: ({ productId, image, alt, isPixelArt, maxImages, actor }) =>
      db.transaction(async (tx): Promise<AddImageOutcome> => {
        // Locking the product serializes two uploads to it, so neither passes the limit.
        const [product] = await tx
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, productId))
          .for("update");
        if (product === undefined) return { _tag: "ProductNotFound" };

        const [held] = await tx
          .select({ total: count(), last: max(productImages.position) })
          .from(productImages)
          .where(eq(productImages.productId, productId));
        if ((held?.total ?? 0) >= maxImages) return { _tag: "LimitReached" };

        await tx.insert(productImages).values({
          id: image.id,
          productId,
          file: image.file,
          alt,
          position: (held?.last ?? -1) + 1,
          isPixelArt,
        });
        await audit.record(tx, {
          actor,
          action: "product.image_add",
          target: { type: "product", id: productId },
          summary: `Added a picture to ${product.name}`,
        });

        return { _tag: "Added" };
      }),

    reorderImages: ({ productId, images, actor }) =>
      db.transaction(async (tx): Promise<ReorderOutcome> => {
        const [product] = await tx
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, productId))
          .for("update");
        if (product === undefined) return { _tag: "ProductNotFound" };

        const current = await tx
          .select({ id: productImages.id, alt: productImages.alt, position: productImages.position })
          .from(productImages)
          .where(eq(productImages.productId, productId))
          .orderBy(asc(productImages.position));

        const known = new Set(current.map((row) => row.id));
        if (images.length !== current.length || images.some((image) => !known.has(image.id))) return { _tag: "Mismatch" };

        // Positions are unique per product, so every row first moves out of the way.
        for (const [index, image] of images.entries()) {
          await tx
            .update(productImages)
            .set({ position: -1 - index })
            .where(and(eq(productImages.id, image.id), eq(productImages.productId, productId)));
        }
        for (const [index, image] of images.entries()) {
          await tx
            .update(productImages)
            .set({ position: index, alt: image.alt })
            .where(and(eq(productImages.id, image.id), eq(productImages.productId, productId)));
        }

        await audit.record(tx, {
          actor,
          action: "product.image_reorder",
          target: { type: "product", id: productId },
          summary: `Reordered and described the pictures of ${product.name}`,
          changes: {
            order: [current.map((row) => row.id), images.map((image) => image.id)],
            alt: [current.map((row) => row.alt), images.map((image) => image.alt)],
          },
        });

        return { _tag: "Reordered" };
      }),

    removeImage: ({ productId, imageId, actor }) =>
      db.transaction(async (tx): Promise<RemoveImageOutcome> => {
        const [removed] = await tx
          .delete(productImages)
          .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
          .returning({ id: productImages.id, file: productImages.file });
        if (removed === undefined) return { _tag: "ImageNotFound" };

        await audit.record(tx, {
          actor,
          action: "product.image_remove",
          target: { type: "product", id: productId },
          summary: "Removed a picture from the product",
        });

        return { _tag: "Removed", image: removed };
      }),
    };
  },
} as const;
