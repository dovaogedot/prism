/**
 * Catalog domain logic and the read-through cache in front of it.
 *
 * The cache sits here rather than in the repository so that the repository
 * stays a plain description of what the database can do, and so a cache miss
 * and a cache hit are the same call to whoever is reading.
 */

import type {
  CategoryNode,
  DomainError,
  ProductDetail,
  ProductFacets,
  ProductImage,
  ProductQuery,
  ProductSearchResult,
  Suggestion,
} from "@prism/shared";
import { Option } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Cache } from "../../platform/cache.ts";
import { cacheKey } from "../../platform/cache.ts";
import type { MediaStorage } from "../../platform/storage.ts";
import type { CatalogRepository } from "./repository.ts";
import { toTotalPages } from "./search.ts";

export type CatalogCaches = Readonly<{
  categories: Cache<readonly CategoryNode[]>;
  facets: Cache<ProductFacets>;
  products: Cache<ProductDetail>;
}>;

export type CatalogDependencies = Readonly<{
  repository: CatalogRepository;
  storage: MediaStorage;
  caches: CatalogCaches;
}>;

export type CatalogService = Readonly<{
  search: (query: ProductQuery) => ResultAsync<ProductSearchResult, DomainError>;
  detail: (slug: string) => ResultAsync<ProductDetail, DomainError>;
  categories: () => ResultAsync<readonly CategoryNode[], DomainError>;
  suggest: (
    term: string,
    limit: number,
  ) => ResultAsync<readonly Suggestion[], DomainError>;
  attachImage: (input: {
    slug: string;
    bytes: Uint8Array;
    alt: string;
  }) => ResultAsync<ProductImage, DomainError>;
}>;

/** The cache key must capture every input that changes the answer. */
const facetCacheKey = (query: ProductQuery): string =>
  cacheKey("facets", {
    text: Option.getOrElse(() => "")(query.text),
    category: Option.getOrElse(() => "")(query.categorySlug),
    brands: query.brandSlugs,
    finishes: query.finishes,
    price: Option.match<{ min: number; max: number }, string>({
      onSome: (range) => `${range.min}-${range.max}`,
      onNone: () => "",
    })(query.price),
    rating: Option.match<number, string>({
      onSome: (value) => String(value),
      onNone: () => "",
    })(query.minRating),
    hue: Option.match<{ min: number; max: number }, string>({
      onSome: (range) => `${range.min}-${range.max}`,
      onNone: () => "",
    })(query.hue),
    saturation: Option.match<{ min: number; max: number }, string>({
      onSome: (range) => `${range.min}-${range.max}`,
      onNone: () => "",
    })(query.saturation),
  });

export const createCatalogService = (deps: CatalogDependencies): CatalogService => {
  const { repository, storage, caches } = deps;

  return {
    /**
     * The page of results is not cached — it varies with sort and page number
     * and is a single indexed query. The facet counts are, because they are
     * five aggregates over the same filter set and every shopper narrowing the
     * same category recomputes exactly the same numbers.
     */
    search: (query) => {
      const key = facetCacheKey(query);
      const cachedFacets = caches.facets.get(key);

      const facets = Option.isSome(cachedFacets)
        ? ResultAsync.fromSafePromise(Promise.resolve(cachedFacets.value))
        : ResultAsync.fromSafePromise(repository.facets(query)).map((computed) => {
            caches.facets.set(key, computed);
            return computed;
          });

      return ResultAsync.combine([
        ResultAsync.fromSafePromise(repository.search(query)),
        facets,
      ]).map(([page, computedFacets]) => ({
        items: page.items,
        facets: computedFacets,
        total: page.total,
        page: query.page,
        perPage: query.perPage,
        totalPages: toTotalPages(page.total, query.perPage),
      }));
    },

    detail: (slug) => {
      const cached = caches.products.get(slug);

      if (Option.isSome(cached)) return okAsync(cached.value);

      return ResultAsync.fromSafePromise(repository.findBySlug(slug)).andThen(
        (found) => {
          if (Option.isNone(found)) {
            return errAsync<ProductDetail, DomainError>({ _tag: "ProductNotFound" });
          }

          caches.products.set(slug, found.value);
          return okAsync<ProductDetail, DomainError>(found.value);
        },
      );
    },

    categories: () => {
      const cached = caches.categories.get("tree");

      if (Option.isSome(cached)) return okAsync(cached.value);

      return ResultAsync.fromSafePromise(repository.categoryTree()).map((tree) => {
        caches.categories.set("tree", tree);
        return tree;
      });
    },

    // Not cached: the key is whatever the shopper has typed so far, so the hit
    // rate would be close to zero and the memory cost close to unbounded.
    suggest: (term, limit) =>
      ResultAsync.fromSafePromise(repository.suggest(term, limit)),

    attachImage: ({ slug, bytes, alt }) =>
      ResultAsync.fromSafePromise(repository.findProductIdBySlug(slug))
        .andThen((found) =>
          Option.isNone(found)
            ? errAsync<string, DomainError>({ _tag: "ProductNotFound" })
            : okAsync<string, DomainError>(found.value),
        )
        .andThen((productId) =>
          storage
            .save(bytes)
            .andThen((stored) =>
              ResultAsync.fromSafePromise(
                repository.addImage({ productId, filename: stored.filename, alt }),
              ),
            )
            .map((image) => {
              // The cached detail still lists the old images.
              caches.products.clear();
              return image;
            }),
        ),
  };
};
