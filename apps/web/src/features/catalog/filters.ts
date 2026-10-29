/**
 * The filters as the URL carries them.
 *
 * The catalog page's query string is the query string of `GET /products`,
 * key for key, so every view is a link. The page forwards the keys the
 * listing reads and leaves out any other, such as a campaign's.
 * Every operation returns a new `URLSearchParams` and leaves its input alone.
 */

import { Price, ProductQuery, type FacetBucket, type ProductFacets } from "@prism/shared"
import { match } from "ts-pattern"
import { UrlParams } from "../../shared/url/url-params.ts"

/** One filter in force: the query pair it stands for, what to call it, and the params without it. */
export type ActiveFilter = Readonly<{ key: string; value: string; label: string; next: URLSearchParams }>

export const CatalogParams = {
  /** Keys that shape the list without narrowing it: the shelf, the order, the paging and how it is drawn. */
  UNFILTERED: new Set(["q", "category", "sort", "page", "perPage", "view"]),

  /** Keys that narrow the list, besides the property filters. */
  FILTERS: new Set(["brand", "priceMin", "priceMax", "rating"]),

  /** Whether `key` narrows the list: a filter the API knows, or a property filter. */
  isFilterKey: (key: string): boolean => CatalogParams.FILTERS.has(key) || key.startsWith(ProductQuery.PROPERTY_PREFIX),

  /** Whether the listing reads `key`. Anything else, such as a campaign's `utm_source`, is not the listing's. */
  isListingKey: (key: string): boolean => CatalogParams.UNFILTERED.has(key) || CatalogParams.isFilterKey(key),

  /** The query key for a filter on the property of that name. */
  propertyKey: (name: string): string => `${ProductQuery.PROPERTY_PREFIX}${name}`,

  /** Whether `value` is among the values of the repeatable `key`. */
  has: (params: URLSearchParams, key: string, value: string): boolean => params.getAll(key).includes(value),

  set: UrlParams.set,

  toggle: UrlParams.toggle,

  /** Whether anything narrows the results. */
  isFiltered: (params: URLSearchParams): boolean => {
    for (const key of params.keys()) if (CatalogParams.isFilterKey(key)) return true
    return false
  },

  /**
   * Every narrowing filter in `params`, in the order the URL carries them,
   * named from `facets`. The two price bounds make one filter, and a value
   * the facets do not list is named by itself.
   */
  active: (params: URLSearchParams, facets: ProductFacets): readonly ActiveFilter[] => {
    const labelOf = (buckets: readonly FacetBucket[], value: string): string =>
      buckets.find((bucket) => bucket.value === value)?.label ?? value
    const priceMin = params.get("priceMin")
    const priceMax = params.get("priceMax")
    const filters: ActiveFilter[] = []

    for (const [key, value] of params) {
      if (!CatalogParams.isFilterKey(key) || (key === "priceMax" && priceMin !== null)) continue

      const label = match(key)
        .with(
          "priceMin",
          "priceMax",
          () => `${Price.format(Number(priceMin ?? facets.price.minCents))} – ${Price.format(Number(priceMax ?? facets.price.maxCents))}`,
        )
        .with("brand", () => labelOf(facets.brands, value))
        .with("rating", () => labelOf(facets.ratings, value))
        .otherwise(() => `${key.startsWith(ProductQuery.PROPERTY_PREFIX) ? key.slice(ProductQuery.PROPERTY_PREFIX.length) : key}: ${value}`)

      const next = match(key)
        .with("priceMin", "priceMax", () => CatalogParams.set(CatalogParams.set(params, "priceMin", ""), "priceMax", ""))
        .otherwise(() => CatalogParams.toggle(params, key, value))

      filters.push({ key, value, label, next })
    }

    return filters
  },

  /** `params` with every narrowing filter removed; the text, category, sort and page size stay. */
  cleared: (params: URLSearchParams): URLSearchParams => {
    const next = new URLSearchParams()

    for (const [key, value] of params) {
      if (CatalogParams.UNFILTERED.has(key) && key !== "page") next.append(key, value)
    }

    return next
  },
} as const
