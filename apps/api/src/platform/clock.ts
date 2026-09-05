/**
 * Time as a dependency.
 *
 * Every expiry check in this codebase asks the injected clock rather than
 * `Date.now()`, which is why the token tests can prove a 15-minute access token
 * expires without taking 15 minutes to do it.
 */

export type Clock = Readonly<{ now: () => Date }>;

/** The wall clock, which is what the application runs on. */
export const systemClock: Clock = { now: () => new Date() };

/** A clock whose reading can be moved, for tests that need time to pass. */
export type MutableClock = Clock &
  Readonly<{
    advanceSeconds: (seconds: number) => void;
    set: (instant: Date) => void;
  }>;

/** A clock tests can wind forward. */
export const mutableClock = (start: Date): MutableClock => {
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
};

/** The instant `seconds` after this clock's current reading. */
export const secondsFromNow = (clock: Clock, seconds: number): Date =>
  new Date(clock.now().getTime() + seconds * 1000);

