import { describe, expect, it } from "vitest";
import { Clock } from "../../../src/platform/clock.ts";
import { RateLimiter, RateLimitPolicy, TokenBucket } from "../../../src/platform/rate-limit.ts";

const shape = { capacity: 5, refillPerSecond: 0.5 };
const start = new Date("2026-08-07T12:00:00.000Z").getTime();

/** Takes `count` tokens in a row at one instant, starting from `state`. */
const drain = (count: number, at: number = start) => {
  let state = TokenBucket.take(undefined, at, shape).state;
  for (let taken = 1; taken < count; taken += 1) state = TokenBucket.take(state, at, shape).state;
  return state;
};

describe("TokenBucket.take", () => {
  it("starts a new key full and takes one token", () => {
    expect(TokenBucket.take(undefined, start, shape)).toMatchObject({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
  });

  it("lets a burst up to the capacity through, then refuses", () => {
    const empty = drain(5);

    expect(empty.tokens).toBe(0);
    expect(TokenBucket.take(empty, start, shape)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("refills by elapsed time, counting fractions of a token", () => {
    const empty = drain(5);

    // 1.5 s at 0.5 a second is three quarters of a token: not enough yet.
    const early = TokenBucket.take(empty, start + 1500, shape);
    expect(early.allowed).toBe(false);
    expect(early.state.tokens).toBeCloseTo(0.75);

    // Half a second later the fraction adds up to a whole token.
    expect(TokenBucket.take(early.state, start + 2000, shape)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("never holds more than the capacity, however long it sat idle", () => {
    const idle = TokenBucket.take(drain(5), start + 24 * 60 * 60 * 1000, shape);

    expect(idle).toMatchObject({ allowed: true, remaining: 4 });
    expect(idle.state.tokens).toBe(4);
  });

  it("rounds the wait up to whole seconds, and waits at least one", () => {
    const empty = drain(5);

    // A whole token takes 2 s at 0.5 a second.
    expect(TokenBucket.take(empty, start, shape).retryAfterSeconds).toBe(2);
    // 0.3 s in, 1.7 s are left: rounded up to 2.
    expect(TokenBucket.take(empty, start + 300, shape).retryAfterSeconds).toBe(2);
    // 1.9 s in, 0.1 s is left: still one whole second.
    expect(TokenBucket.take(empty, start + 1900, shape).retryAfterSeconds).toBe(1);
  });

  it("does not refill when the clock moves backwards", () => {
    const empty = drain(5);

    expect(TokenBucket.take(empty, start - 60_000, shape).allowed).toBe(false);
  });
});

describe("TokenBucket.isFull", () => {
  it("is true once a bucket has refilled to its capacity", () => {
    const empty = drain(5);

    expect(TokenBucket.isFull(empty, start + 9_999, shape)).toBe(false);
    expect(TokenBucket.isFull(empty, start + 10_000, shape)).toBe(true);
  });
});

describe("RateLimitPolicy.scaled", () => {
  it("multiplies the capacity and the refill rate alike", () => {
    expect(RateLimitPolicy.scaled({ key: "address", capacity: 10, refillPerSecond: 1 / 6 }, 3)).toEqual({
      key: "address",
      capacity: 30,
      refillPerSecond: 0.5,
    });
  });

  it("names every policy in the table once", () => {
    expect([...RateLimitPolicy.NAMES].sort()).toEqual(Object.keys(RateLimitPolicy.table).sort());
  });
});

describe("RateLimiter", () => {
  it("keeps one bucket per policy and key", () => {
    const limiter = RateLimiter.create({ clock: Clock.mutable(new Date(start)), scale: 1 });

    for (let taken = 0; taken < 5; taken += 1) limiter.take("account-login", "mari");

    expect(limiter.take("account-login", "mari").allowed).toBe(false);
    expect(limiter.take("account-login", "jaan").allowed).toBe(true);
    expect(limiter.take("credentials", "mari").allowed).toBe(true);
  });

  it("scales every policy", () => {
    const limiter = RateLimiter.create({ clock: Clock.mutable(new Date(start)), scale: 2 });

    for (let taken = 0; taken < 10; taken += 1) expect(limiter.take("account-login", "mari").allowed).toBe(true);
    expect(limiter.take("account-login", "mari").allowed).toBe(false);
  });

  it("forgets buckets that are full again when it sweeps", () => {
    const clock = Clock.mutable(new Date(start));
    const limiter = RateLimiter.create({ clock, scale: 1, sweepIntervalMs: 60_000 });

    limiter.take("default", "a");
    limiter.take("default", "b");
    limiter.take("contact", "c");
    expect(limiter.size()).toBe(3);

    // A minute on, both default buckets refilled; the contact one, at a token
    // per five minutes, did not.
    clock.advanceSeconds(60);
    limiter.take("default", "d");

    expect(limiter.size()).toBe(2);
  });

  it("holds at most its key cap, dropping the least recently used", () => {
    const limiter = RateLimiter.create({ clock: Clock.mutable(new Date(start)), scale: 1, maxKeys: 3 });

    for (const key of ["a", "b", "c"]) limiter.take("contact", key);
    // Touching "a" makes "b" the least recently used.
    limiter.take("contact", "a");
    limiter.take("contact", "d");

    expect(limiter.size()).toBe(3);
    // "b" was dropped, so it starts full again; "a" kept its spent tokens.
    expect(limiter.take("contact", "b")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.take("contact", "a")).toMatchObject({ allowed: true, remaining: 0 });
  });
});
