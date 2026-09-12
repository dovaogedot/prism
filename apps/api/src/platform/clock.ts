/**
 * Time as a dependency. Every expiry check asks the injected clock rather
 * than `Date.now()`, so a test proves a 15-minute token expires without
 * waiting 15 minutes.
 */

/** A source of the current instant. */
export type Clock = Readonly<{ now: () => Date }>;

/** A clock whose reading can be moved, for tests that need time to pass. */
export type MutableClock = Clock &
  Readonly<{
    advanceSeconds: (seconds: number) => void;
    set: (instant: Date) => void;
  }>;

export const Clock = {
  /** The wall clock, which the application runs on. */
  system: { now: () => new Date() },

  /** A clock that starts at `start` and moves only when told to. */
  mutable: (start: Date): MutableClock => {
    let current = start.getTime();

    return {
      now: () => new Date(current),
      advanceSeconds: (seconds) => {
        current += seconds * 1000;
      },
      set: (instant) => {
        current = instant.getTime();
      },
    };
  },

  /** The instant `seconds` after the clock's current reading. */
  after: (clock: Clock, seconds: number): Date => new Date(clock.now().getTime() + seconds * 1000),
} as const;
