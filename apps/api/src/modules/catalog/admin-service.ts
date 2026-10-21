/**
 * The catalog pages of the admin: products with their properties and
 * pictures, categories, brands, and bulk import. A picture upload is
 * checked, encoded again and given its smaller copies before the request
 * answers; files of a removed picture or product go once the removal has
 * committed. An import writes every row or none.
 */

import type {
  AdminBrand,
  AdminCategory,
  AdminProductDetail,
  AdminProductQuery,
  AdminProductSummary,
  BrandId,
  BrandInput,
  CategoryId,
  CategoryInput,
  DomainError,
  ImageId,
  ImportReport,
  Page,
  ProductId,
  ProductImage,
  ProductInput,
} from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../../platform/clock.ts";
import type { ImageStore } from "../../platform/image-store.ts";
import type { StaffActor } from "../staff/audit.ts";
import type { CatalogAdminRepository, DeleteOutcome, SaveOutcome } from "./admin-repository.ts";
import { ImportFile } from "./import.ts";
import type { CatalogRepository } from "./repository.ts";

/** What the catalog admin works through. */
export type CatalogAdminDependencies = Readonly<{
  repository: CatalogAdminRepository;
  catalog: CatalogRepository;
  images: ImageStore;
  clock: Clock;
  /** Reports a step that failed after its change committed, such as deleting a removed picture's file. */
  onFailure: (reason: unknown) => void;
}>;

/** An import file as the request carried it. */
export type ImportUpload = Readonly<{ filename: string; mimetype: string; text: string }>;

/** A picture as an upload carries it. */
export type ImageUpload = Readonly<{ bytes: Buffer; alt: string; isPixelArt: boolean }>;

/** Everything the catalog pages of the admin do. Each change answers what it changed as it now stands. */
export type CatalogAdminService = Readonly<{
  listProducts: (query: AdminProductQuery) => Promise<Page<AdminProductSummary>>;
  product: (productId: ProductId) => ResultAsync<AdminProductDetail, DomainError>;
  createProduct: (actor: StaffActor, input: ProductInput) => ResultAsync<AdminProductDetail, DomainError>;
  updateProduct: (actor: StaffActor, productId: ProductId, input: ProductInput) => ResultAsync<AdminProductDetail, DomainError>;
  deleteProduct: (actor: StaffActor, productId: ProductId) => ResultAsync<void, DomainError>;
  categories: () => Promise<readonly AdminCategory[]>;
  saveCategory: (actor: StaffActor, id: CategoryId | undefined, input: CategoryInput) => ResultAsync<AdminCategory, DomainError>;
  deleteCategory: (actor: StaffActor, id: CategoryId) => ResultAsync<void, DomainError>;
  brands: () => Promise<readonly AdminBrand[]>;
  saveBrand: (actor: StaffActor, id: BrandId | undefined, input: BrandInput) => ResultAsync<AdminBrand, DomainError>;
  deleteBrand: (actor: StaffActor, id: BrandId) => ResultAsync<void, DomainError>;
  /**
   * Checks a file and, unless `dryRun`, writes it. A dry run answers its
   * report, problems included; a real run with any problem writes nothing
   * and answers `ImportInvalid`, whose issues have the path `<row>:<column>`.
   */
  importFile: (actor: StaffActor, file: ImportUpload, dryRun: boolean) => ResultAsync<ImportReport, DomainError>;
  images: (productId: ProductId) => ResultAsync<readonly ProductImage[], DomainError>;
  addImage: (actor: StaffActor, productId: ProductId, upload: ImageUpload) => ResultAsync<readonly ProductImage[], DomainError>;
  reorderImages: (
    actor: StaffActor,
    productId: ProductId,
    images: readonly Readonly<{ id: ImageId; alt: string }>[],
  ) => ResultAsync<readonly ProductImage[], DomainError>;
  removeImage: (actor: StaffActor, productId: ProductId, imageId: ImageId) => ResultAsync<readonly ProductImage[], DomainError>;
}>;

export const CatalogAdminService = {
  /** The most pictures one product shows. */
  MAX_IMAGES: 12,

  /** What a refused save of something named `noun` tells the person. */
  saveFailure: <T>(outcome: Exclude<SaveOutcome<T>, { _tag: "Saved" }>, notFound: DomainError, noun: string): DomainError => {
    if (outcome._tag === "NotFound") return notFound;
    if (outcome._tag === "SlugTaken") {
      return { _tag: "ValidationFailed", issues: [{ path: "slug", message: `Another ${noun} uses this slug.` }] };
    }
    return {
      _tag: "ValidationFailed",
      issues: [{ path: outcome.field, message: `Choose a ${outcome.field === "categoryId" ? "category" : "brand"} that exists.` }],
    };
  },

  deleteFailure: (outcome: DeleteOutcome, notFound: DomainError, inUse: DomainError): DomainError | undefined => {
    if (outcome._tag === "NotFound") return notFound;
    if (outcome._tag === "InUse") return inUse;
    return undefined;
  },

  create: (deps: CatalogAdminDependencies): CatalogAdminService => {
    const { repository, images, clock } = deps;

    const product = (productId: ProductId): ResultAsync<AdminProductDetail, DomainError> =>
      ResultAsync.fromSafePromise(repository.product(productId)).andThen((found) =>
        found === undefined
          ? errAsync<AdminProductDetail, DomainError>({ _tag: "ProductNotFound" })
          : okAsync<AdminProductDetail, DomainError>(found),
      );

    const savedProduct = (outcome: SaveOutcome<ProductId>): ResultAsync<AdminProductDetail, DomainError> =>
      outcome._tag === "Saved"
        ? product(outcome.id)
        : errAsync(CatalogAdminService.saveFailure(outcome, { _tag: "ProductNotFound" }, "product"));

    /** The listed category or brand with `id`, once a save of it went through. */
    const savedAmong = <T extends { id: string }, I>(
      outcome: SaveOutcome<I>,
      list: () => Promise<readonly T[]>,
      notFound: DomainError,
      noun: string,
    ): ResultAsync<T, DomainError> => {
      if (outcome._tag !== "Saved") return errAsync(CatalogAdminService.saveFailure(outcome, notFound, noun));

      return ResultAsync.fromSafePromise(list()).andThen((all) => {
        const saved = all.find((item) => item.id === outcome.id);
        return saved === undefined ? errAsync<T, DomainError>(notFound) : okAsync<T, DomainError>(saved);
      });
    };

    const deleted = (outcome: Promise<DeleteOutcome>, notFound: DomainError, inUse: DomainError): ResultAsync<void, DomainError> =>
      ResultAsync.fromSafePromise(outcome).andThen((settled) => {
        const failure = CatalogAdminService.deleteFailure(settled, notFound, inUse);
        return failure === undefined ? okAsync<void, DomainError>(undefined) : errAsync<void, DomainError>(failure);
      });

    const imagesOf = (productId: ProductId): ResultAsync<readonly ProductImage[], DomainError> =>
      ResultAsync.fromSafePromise(repository.imagesOf(productId)).andThen((found) =>
        found === undefined
          ? errAsync<readonly ProductImage[], DomainError>({ _tag: "ProductNotFound" })
          : okAsync<readonly ProductImage[], DomainError>(found),
      );

    return {
      listProducts: (query) => repository.listProducts(query),

      product,

      createProduct: (actor, input) =>
        ResultAsync.fromSafePromise(repository.createProduct(input, actor, clock.now())).andThen(savedProduct),

      updateProduct: (actor, productId, input) =>
        ResultAsync.fromSafePromise(repository.updateProduct(productId, input, actor, clock.now())).andThen(savedProduct),

      deleteProduct: (actor, productId) =>
        ResultAsync.fromSafePromise(repository.deleteProduct(productId, actor)).andThen((removed) => {
          if (removed === undefined) return errAsync<void, DomainError>({ _tag: "ProductNotFound" });

          return ResultAsync.fromSafePromise(
            Promise.all(removed.map((image) => images.remove(image).catch(deps.onFailure))).then(() => undefined),
          );
        }),

      categories: () => repository.categories(),

      saveCategory: (actor, id, input) =>
        ResultAsync.fromSafePromise(repository.saveCategory(id, input, actor)).andThen((outcome) =>
          savedAmong(outcome, repository.categories, { _tag: "CategoryNotFound" }, "category"),
        ),

      deleteCategory: (actor, id) => deleted(repository.deleteCategory(id, actor), { _tag: "CategoryNotFound" }, { _tag: "CategoryInUse" }),

      brands: () => repository.brands(),

      saveBrand: (actor, id, input) =>
        ResultAsync.fromSafePromise(repository.saveBrand(id, input, actor)).andThen((outcome) =>
          savedAmong(outcome, repository.brands, { _tag: "BrandNotFound" }, "brand"),
        ),

      deleteBrand: (actor, id) => deleted(repository.deleteBrand(id, actor), { _tag: "BrandNotFound" }, { _tag: "BrandInUse" }),

      importFile: (actor, file, dryRun) => {
        const parsed = ImportFile.parse(file);

        // The references are checked even when the file has other problems, so one pass names them all.
        return ResultAsync.fromSafePromise(repository.importProducts(parsed.rows, true, actor, clock.now())).andThen((checked) => {
          const issues = [...parsed.issues, ...(checked._tag === "Invalid" ? checked.issues : [])].toSorted(
            (a, b) => a.row - b.row || a.column.localeCompare(b.column),
          );
          const counts = checked._tag === "Imported" ? checked : { created: 0, updated: 0 };

          if (dryRun) {
            return okAsync<ImportReport, DomainError>({ dryRun, created: counts.created, updated: counts.updated, issues });
          }
          if (issues.length > 0) {
            return errAsync<ImportReport, DomainError>({
              _tag: "ImportInvalid",
              issues: issues.map((issue) => ({ path: `${issue.row}:${issue.column}`, message: issue.message })),
            });
          }

          return ResultAsync.fromSafePromise(repository.importProducts(parsed.rows, false, actor, clock.now())).map((written) => ({
            dryRun,
            created: written._tag === "Imported" ? written.created : 0,
            updated: written._tag === "Imported" ? written.updated : 0,
            issues: [],
          }));
        });
      },

      images: imagesOf,

      addImage: (actor, productId, upload) =>
        images.save(upload.bytes).andThen((stored) =>
          ResultAsync.fromSafePromise(
            repository.addImage({
              productId,
              image: stored,
              alt: upload.alt,
              isPixelArt: upload.isPixelArt,
              maxImages: CatalogAdminService.MAX_IMAGES,
              actor,
            }),
          ).andThen((outcome) => {
            if (outcome._tag !== "Added") {
              // The file was written before the row was refused; nothing points at it.
              void images.remove(stored).catch(deps.onFailure);
              return errAsync<readonly ProductImage[], DomainError>(
                outcome._tag === "LimitReached" ? { _tag: "ImageLimitReached" } : { _tag: "ProductNotFound" },
              );
            }

            return ResultAsync.fromSafePromise(
              images
                .makeVariants({ id: stored.id, file: stored.file, isPixelArt: upload.isPixelArt })
                .then((size) => deps.catalog.recordImageSize(stored.id, size))
                // Housekeeping makes the copies later; the picture shows from its source until then.
                .catch(deps.onFailure),
            ).andThen(() => imagesOf(productId));
          }),
        ),

      reorderImages: (actor, productId, order) =>
        ResultAsync.fromSafePromise(repository.reorderImages({ productId, images: order, actor })).andThen((outcome) => {
          if (outcome._tag === "ProductNotFound") return errAsync<readonly ProductImage[], DomainError>({ _tag: "ProductNotFound" });
          if (outcome._tag === "Mismatch") {
            return errAsync<readonly ProductImage[], DomainError>({
              _tag: "ValidationFailed",
              issues: [{ path: "images", message: "List every picture of the product, each once." }],
            });
          }
          return imagesOf(productId);
        }),

      removeImage: (actor, productId, imageId) =>
        ResultAsync.fromSafePromise(repository.removeImage({ productId, imageId, actor })).andThen((outcome) => {
          if (outcome._tag === "ImageNotFound") return errAsync<readonly ProductImage[], DomainError>({ _tag: "ImageNotFound" });

          return ResultAsync.fromSafePromise(images.remove(outcome.image).catch(deps.onFailure)).andThen(() =>
            imagesOf(productId),
          );
        }),
    };
  },
} as const;
