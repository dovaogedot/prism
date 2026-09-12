/**
 * The filters as the URL carries them.
 *
 * The catalog page's query string is the query string of `GET /products`,
 * key for key, so the page forwards it as it is and every view is a link.
 * Every operation returns a new `URLSearchParams` and leaves its input alone.
 */

import { ProductQuery } from "@prism/shared";

export const CatalogParams = {
  /** Keys that shape the list without narrowing it. */
  UNFILTERED: new Set(["q", "sort", "page", "perPage"]),

  /** The query key for a filter on the property of that name. */
  propertyKey: (name: string): string => `${ProductQuery.PROPERTY_PREFIX}${name}`,

  /** Whether `value` is among the values of the repeatable `key`. */
  has: (params: URLSearchParams, key: string, value: string): boolean => params.getAll(key).includes(value),

  /**
   * `params` with `key` set to `value`, or without `key` when `value` is
   * empty. Any change but the page itself starts again from page one.
   */
  set: (params: URLSearchParams, key: string, value: string): URLSearchParams => {
    const next = new URLSearchParams(params);

    if (value.length === 0) next.delete(key);
    else next.set(key, value);

    if (key !== "page") next.delete("page");

    return next;
  },

  /** `params` with `value` added to the repeatable `key` if absent, or removed if present. */
  toggle: (params: URLSearchParams, key: string, value: string): URLSearchParams => {
    const next = new URLSearchParams(params);
    const values = next.getAll(key);

    next.delete(key);
    for (const current of values) if (current !== value) next.append(key, current);
    if (!values.includes(value)) next.append(key, value);
    next.delete("page");

    return next;
  },

  /** Whether anything narrows the results. */
  isFiltered: (params: URLSearchParams): boolean => {
    for (const key of params.keys()) if (!CatalogParams.UNFILTERED.has(key)) return true;
    return false;
  },

  /** `params` with every narrowing filter removed; the text, sort and page size stay. */
  cleared: (params: URLSearchParams): URLSearchParams => {
    const next = new URLSearchParams();

    for (const [key, value] of params) {
      if (CatalogParams.UNFILTERED.has(key) && key !== "page") next.append(key, value);
    }

    return next;
  },
} as const;
