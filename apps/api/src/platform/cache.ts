/**
 * A small in-process TTL cache.
 *
 * One API container means a shared cache would be a network hop to hold data
 * this process already has. The `Cache<A>` port is what matters: swapping in a
 * Redis adapter when there are two containers is a new file, not a refactor.
 *
 * Typed per value rather than a single `Cache` holding `unknown` — a cache that
 * hands back whatever the caller claims it stored is a cast with extra steps.
 */

import { Option } from "@prism/shared";
import type { Clock } from "./clock.ts";

export type Cache<A> = Readonly<{
  get: (key: string) => Option<A>;
  set: (key: string, value: A) => void;
  /** Called when a write makes some or all of the cached reads wrong. */
  clear: () => void;
  size: () => number;
}>;

export type CacheOptions = Readonly<{
  clock: Clock;
  ttlSeconds: number;
  /** Bounds memory. Oldest insertion is evicted first. */
  maxEntries?: number;
}>;

type Entry<A> = Readonly<{ value: A; expiresAtMs: number }>;

const DEFAULT_MAX_ENTRIES = 500;

export const createTtlCache = <A>(options: CacheOptions): Cache<A> => {
  const { clock, ttlSeconds } = options;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  // Map preserves insertion order, so the first key is the oldest entry.
  const entries = new Map<string, Entry<A>>();

  const evictOldest = (): void => {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  };

  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return Option.none;

      // Expiry is lazy: no timers to leak, no sweep to schedule.
      if (entry.expiresAtMs <= clock.now().getTime()) {
        entries.delete(key);
        return Option.none;
      }

      return Option.some(entry.value);
    },

    set: (key, value) => {
      // Re-inserting must refresh insertion order, or eviction picks wrongly.
      entries.delete(key);

      if (entries.size >= maxEntries) evictOldest();

      entries.set(key, {
        value,
        expiresAtMs: clock.now().getTime() + ttlSeconds * 1000,
      });
    },

    clear: () => entries.clear(),

    size: () => entries.size,
  };
};

/**
 * Builds a stable cache key from query parameters.
 *
 * Two rules, both load-bearing. Entries are sorted, because object key order
 * varies with construction and an unsorted key would mean the same filter set
 * produces two entries and the cache quietly never hits.
 *
 * And every value is percent-encoded, because the search term is free text: a
 * shopper searching for `red&category=blues` would otherwise build the exact
 * key that `q=red` plus `category=blues` builds, and the two would share a
 * cache entry and see each other's facet counts.
 */
export const cacheKey = (
  namespace: string,
  parts: Readonly<Record<string, string | number | readonly string[]>>,
): string => {
  const encoded = Object.entries(parts)
    .map(([key, value]): readonly [string, string] => [
      key,
      Array.isArray(value)
        ? [...value].sort().map(encodeURIComponent).join("|")
        : encodeURIComponent(String(value)),
    ])
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return `${namespace}:${encoded}`;
};
