import { Option } from "@hue/shared";
import { describe, expect, it } from "vitest";
import { mutableClock } from "./clock.ts";
import { cacheKey, createTtlCache } from "./cache.ts";

const START = new Date("2026-08-07T12:00:00.000Z");

const build = (ttlSeconds = 60, maxEntries = 100) => {
  const clock = mutableClock(START);
  return { clock, cache: createTtlCache<string>({ clock, ttlSeconds, maxEntries }) };
};

describe("TTL cache", () => {
  it("returns None for a key it has never seen", () => {
    const { cache } = build();
    expect(cache.get("absent")).toEqual(Option.none);
  });

  it("returns a stored value", () => {
    const { cache } = build();
    cache.set("k", "v");
    expect(cache.get("k")).toEqual(Option.some("v"));
  });

  it("still returns the value one second before expiry", () => {
    const { cache, clock } = build(60);
    cache.set("k", "v");
    clock.advanceSeconds(59);
    expect(cache.get("k")).toEqual(Option.some("v"));
  });

  it("expires exactly at the TTL boundary", () => {
    const { cache, clock } = build(60);
    cache.set("k", "v");
    clock.advanceSeconds(60);
    expect(cache.get("k")).toEqual(Option.none);
  });

  it("drops the expired entry rather than keeping it around", () => {
    const { cache, clock } = build(60);
    cache.set("k", "v");
    clock.advanceSeconds(61);
    cache.get("k");
    expect(cache.size()).toBe(0);
  });

  it("re-setting a key refreshes its lifetime", () => {
    const { cache, clock } = build(60);
    cache.set("k", "first");
    clock.advanceSeconds(59);
    cache.set("k", "second");
    clock.advanceSeconds(59);
    expect(cache.get("k")).toEqual(Option.some("second"));
  });

  it("clear empties everything", () => {
    const { cache } = build();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toEqual(Option.none);
  });

  it("caches a falsy value as a real hit, not a miss", () => {
    const clock = mutableClock(START);
    const cache = createTtlCache<string>({ clock, ttlSeconds: 60 });
    cache.set("empty", "");
    expect(cache.get("empty")).toEqual(Option.some(""));
  });
});

describe("eviction", () => {
  it("never exceeds its maximum size", () => {
    const { cache } = build(60, 3);

    for (const key of ["a", "b", "c", "d", "e"]) cache.set(key, key);

    expect(cache.size()).toBeLessThanOrEqual(3);
  });

  it("evicts the oldest insertion first", () => {
    const { cache } = build(60, 3);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");

    expect(cache.get("a")).toEqual(Option.none);
    expect(cache.get("d")).toEqual(Option.some("4"));
  });

  it("treats a re-set key as newly inserted for eviction order", () => {
    const { cache } = build(60, 3);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("a", "1-again"); // moves 'a' to the back of the queue
    cache.set("d", "4"); // should evict 'b', the oldest now

    expect(cache.get("a")).toEqual(Option.some("1-again"));
    expect(cache.get("b")).toEqual(Option.none);
  });
});

describe("cacheKey", () => {
  it("is stable regardless of property order", () => {
    expect(cacheKey("facets", { a: "1", b: "2" })).toBe(
      cacheKey("facets", { b: "2", a: "1" }),
    );
  });

  it("is stable regardless of array order", () => {
    expect(cacheKey("facets", { brands: ["b", "a"] })).toBe(
      cacheKey("facets", { brands: ["a", "b"] }),
    );
  });

  it("omits empty values, so absent and blank filters share a key", () => {
    expect(cacheKey("facets", { a: "1", b: "" })).toBe(cacheKey("facets", { a: "1" }));
    expect(cacheKey("facets", { a: "1", brands: [] })).toBe(
      cacheKey("facets", { a: "1" }),
    );
  });

  it("distinguishes genuinely different filter sets", () => {
    expect(cacheKey("facets", { category: "reds" })).not.toBe(
      cacheKey("facets", { category: "blues" }),
    );
  });

  it("keeps namespaces apart", () => {
    expect(cacheKey("facets", { a: "1" })).not.toBe(cacheKey("products", { a: "1" }));
  });

  it("does not collide when a value contains the separator", () => {
    expect(cacheKey("n", { a: "1&b=2" })).not.toBe(cacheKey("n", { a: "1", b: "2" }));
  });
});
