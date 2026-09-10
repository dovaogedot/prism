/**
 * Catalog domain logic and the read-through cache in front of it.
 *
 * The cache sits here rather than in the repository so that the repository
 * stays a plain description of what the database can do, and so a cache miss
 * and a cache hit are the same call to whoever is reading.
 */

import type {
  DomainError,
  NumericRange,
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

/** The three things worth holding between requests, each with its own lifetime. */
export type CatalogCaches = Readonly<{
  facets: Cache<ProductFacets>;
  products: Cache<ProductDetail>;
}>;

/** Every port the catalog module works through. */
export type CatalogDependencies = Readonly<{
  repository: CatalogRepository;
  storage: MediaStorage;
  caches: CatalogCaches;
}>;

/** Everything the shopfront can ask of the catalog, with every failure a `DomainError`. */
export type CatalogService = Readonly<{
  search: (query: ProductQuery) => ResultAsync<ProductSearchResult, DomainError>;
  detail: (slug: string) => ResultAsync<ProductDetail, DomainError>;
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

/** Ranges all key the same way, and an absent one keys as the empty string. */
const rangeKey = Option.match<NumericRange, string>({
  onSome: (range) => `${range.min}-${range.max}`,
  onNone: () => "",
});

/**
 * The cache key must capture every input that changes the answer — every
 * filter, in other words, since each one moves the counts in every other
 * dimension. Sort and page are absent because facets do not depend on them.
 */
const facetCacheKey = (query: ProductQuery): string =>
  cacheKey("facets", {
    text: Option.getOrElse(() => "")(query.text),
    kind: Option.getOrElse<string>(() => "")(query.kind),
    family: Option.getOrElse<string>(() => "")(query.family),
    brands: query.brandSlugs,
    finishes: query.finishes,
    direction: Option.getOrElse<string>(() => "")(query.direction),
    arc: rangeKey(query.arc),
    price: rangeKey(query.price),
    rating: Option.match<number, string>({
      onSome: (value) => String(value),
      onNone: () => "",
    })(query.minRating),
    hue: rangeKey(query.hue),
    saturation: rangeKey(query.saturation),
    lightness: rangeKey(query.lightness),
    roughness: rangeKey(query.roughness),
    coating: rangeKey(query.coating),
    emission: rangeKey(query.emission),
  });

/**
 * The catalog module over the ports it is given.
 *
 * Writing an image clears the caches a write makes wrong, so a read after a
 * write never serves the answer from before it.
 */
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
