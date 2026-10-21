/**
 * Rate limiting with token buckets. A policy gives each key, such as a client
 * address or a user, a bucket that holds up to `capacity` tokens and refills
 * continuously at `refillPerSecond`. Every request takes one token, so a burst
 * up to the capacity passes at once, and sustained traffic passes at the
 * refill rate and no faster.
 *
 * The buckets live in this process's memory, read against the injected clock.
 */

import type { Clock } from "./clock.ts";

/** A bucket: the tokens it held at `updatedAt`, in milliseconds since the epoch. Fractional between refills. */
export type BucketState = Readonly<{ tokens: number; updatedAt: number }>;

/** How many tokens a bucket holds, and how fast it gets them back. */
export type BucketShape = Readonly<{ capacity: number; refillPerSecond: number }>;

/** What taking one token found. */
export type TakeResult = Readonly<{
  allowed: boolean;
  /** Whole tokens left once this request is counted. */
  remaining: number;
  /** Whole seconds until a token is back; 0 when the request was allowed. */
  retryAfterSeconds: number;
  /** The bucket as this request leaves it. */
  state: BucketState;
}>;

export const TokenBucket = {
  /**
   * Refills `state` for the time since it was last counted, up to the
   * capacity, and takes one token when there is a whole one. A key with no
   * bucket yet starts full.
   */
  take: (state: BucketState | undefined, now: number, shape: BucketShape): TakeResult => {
    const elapsedSeconds = state === undefined ? 0 : Math.max(0, now - state.updatedAt) / 1000;
    const available =
      state === undefined ? shape.capacity : Math.min(shape.capacity, state.tokens + elapsedSeconds * shape.refillPerSecond);

    if (available >= 1) {
      return {
        allowed: true,
        remaining: Math.floor(available - 1),
        retryAfterSeconds: 0,
        state: { tokens: available - 1, updatedAt: now },
      };
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - available) / shape.refillPerSecond)),
      state: { tokens: available, updatedAt: now },
    };
  },

  /** Whether the bucket has refilled to its capacity by `now`, which makes it the same as no bucket. */
  isFull: (state: BucketState, now: number, shape: BucketShape): boolean =>
    state.tokens + (Math.max(0, now - state.updatedAt) / 1000) * shape.refillPerSecond >= shape.capacity,
} as const;

/** Who a policy counts requests against: the client's address, the signed-in user, or the account being signed in to. */
export type RateLimitKey = "address" | "user" | "account";

/** One named budget. */
export type RateLimitPolicy = BucketShape & Readonly<{ key: RateLimitKey }>;

/** The name a route gives its budget. */
export type RateLimitPolicyName =
  | "credentials"
  | "account-login"
  | "session"
  | "checkout"
  | "contact"
  | "suggest"
  | "member-write"
  | "staff-write"
  | "import"
  | "default";

export const RateLimitPolicy = {
  /** Every budget the API has. A route without one of its own falls under `default`. */
  table: {
    // Everything that checks a password or a code: the thing worth guessing.
    credentials: { key: "address", capacity: 10, refillPerSecond: 1 / 6 },
    // One account guessed at from many addresses still runs dry.
    "account-login": { key: "account", capacity: 5, refillPerSecond: 1 / 60 },
    // Every page load refreshes the session, so this is roomier.
    session: { key: "address", capacity: 30, refillPerSecond: 1 },
    checkout: { key: "address", capacity: 10, refillPerSecond: 1 / 6 },
    contact: { key: "address", capacity: 3, refillPerSecond: 1 / 300 },
    // A request per keystroke, so a burst of typing has to fit.
    suggest: { key: "address", capacity: 40, refillPerSecond: 5 },
    "member-write": { key: "user", capacity: 30, refillPerSecond: 1 / 2 },
    "staff-write": { key: "user", capacity: 60, refillPerSecond: 2 },
    import: { key: "user", capacity: 5, refillPerSecond: 1 / 30 },
    default: { key: "address", capacity: 120, refillPerSecond: 20 },
  } as const satisfies Record<RateLimitPolicyName, RateLimitPolicy>,

  NAMES: [
    "credentials",
    "account-login",
    "session",
    "checkout",
    "contact",
    "suggest",
    "member-write",
    "staff-write",
    "import",
    "default",
  ] as const satisfies readonly RateLimitPolicyName[],

  /** A policy with its capacity and refill rate both multiplied by `scale`. */
  scaled: (policy: RateLimitPolicy, scale: number): RateLimitPolicy => ({
    key: policy.key,
    capacity: policy.capacity * scale,
    refillPerSecond: policy.refillPerSecond * scale,
  }),
} as const;

/** Every bucket of every policy, and the one way to take from them. */
export type RateLimiter = Readonly<{
  /** Takes one token from the bucket of `key` under `policy`. */
  take: (policy: RateLimitPolicyName, key: string) => TakeResult;
  /** The policy as scaled for this limiter. */
  policyOf: (policy: RateLimitPolicyName) => RateLimitPolicy;
  /** How many buckets are held across every policy. */
  size: () => number;
}>;

/** What a limiter is built from. */
export type RateLimiterOptions = Readonly<{
  clock: Clock;
  /** Multiplies every capacity and refill rate; 1 in production. */
  scale: number;
  /** The most buckets held at once. */
  maxKeys?: number;
  /** How often full buckets are forgotten. */
  sweepIntervalMs?: number;
}>;

export const RateLimiter = {
  MAX_KEYS: 100_000,
  SWEEP_INTERVAL_MS: 60_000,

  create: (options: RateLimiterOptions): RateLimiter => {
    const maxKeys = options.maxKeys ?? RateLimiter.MAX_KEYS;
    const sweepIntervalMs = options.sweepIntervalMs ?? RateLimiter.SWEEP_INTERVAL_MS;
    const policies = new Map<RateLimitPolicyName, RateLimitPolicy>(
      RateLimitPolicy.NAMES.map((name) => [name, RateLimitPolicy.scaled(RateLimitPolicy.table[name], options.scale)]),
    );
    // One map per policy, each in least-recently-used order: a key is
    // deleted and set again on every take, which moves it to the end.
    const buckets = new Map<RateLimitPolicyName, Map<string, BucketState>>(
      RateLimitPolicy.NAMES.map((name) => [name, new Map<string, BucketState>()]),
    );
    let held = 0;
    let lastSweep = options.clock.now().getTime();

    const policyOf = (name: RateLimitPolicyName): RateLimitPolicy => {
      const policy = policies.get(name);
      if (policy === undefined) throw new Error(`No rate-limit policy named ${name}.`);
      return policy;
    };

    const bucketsOf = (name: RateLimitPolicyName): Map<string, BucketState> => {
      const map = buckets.get(name);
      if (map === undefined) throw new Error(`No rate-limit policy named ${name}.`);
      return map;
    };

    /** Forgets every full bucket, then the least recently used ones while there are too many. */
    const sweep = (now: number): void => {
      lastSweep = now;

      for (const [name, map] of buckets) {
        const policy = policyOf(name);

        for (const [key, state] of map) {
          if (TokenBucket.isFull(state, now, policy)) {
            map.delete(key);
            held -= 1;
          }
        }
      }

      while (held >= maxKeys) {
        let largest: Map<string, BucketState> | undefined;
        for (const map of buckets.values()) {
          if (largest === undefined || map.size > largest.size) largest = map;
        }

        const oldest = largest?.keys().next();
        if (largest === undefined || oldest === undefined || oldest.done === true) return;

        largest.delete(oldest.value);
        held -= 1;
      }
    };

    return {
      take: (name, key) => {
        const now = options.clock.now().getTime();
        const map = bucketsOf(name);

        if (now - lastSweep >= sweepIntervalMs || (held >= maxKeys && !map.has(key))) sweep(now);

        const previous = map.get(key);
        const result = TokenBucket.take(previous, now, policyOf(name));

        if (previous === undefined) held += 1;
        else map.delete(key);
        map.set(key, result.state);

        return result;
      },

      policyOf,

      size: () => held,
    };
  },
} as const;
