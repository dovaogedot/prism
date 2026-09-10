/**
 * The lamps that circle a roughness room, and how slowly each of them follows.
 *
 * A roughness finisher has nothing to show but a highlight, and one highlight
 * standing still says very little about how scattered it is. So the lamps
 * move: they hang in a ring around the subject, the pointer turns the whole
 * ring, and each lamp walks toward its own place on the turned ring at its
 * own rate. A flick of the pointer throws them out of formation — the quick
 * ones arrive, the slow ones straggle — and they gather back up. A smooth
 * finish tracks that as four separate points; a rough one smears it into one
 * broad wash that never resolves.
 *
 * The lags are a property of the room, not of the finisher. Every roughness
 * finisher is lit by the same four lamps behaving the same way; what differs
 * between two of them is the surface they land on.
 */

import { arrived, toward } from "./ease.ts";
import { eyeAt, type Eye, type Orbit } from "./orbit.ts";

/**
 * Seconds in which each lamp covers about 63% of the distance left.
 *
 * Spread wide on purpose: two lamps a hair apart move as one, and the point is
 * to see them come apart. The quickest is inside the settle the rest of the
 * site uses and the slowest is five times it, so a flick spreads the four out
 * across most of a second before they close up again.
 */
export const LAGS: readonly number[] = [0.06, 0.13, 0.26, 0.45];

/** Below this a lamp is within a five-hundredth of a mesh width of its place. */
const SETTLED_UNITS = 0.002;

/** One lamp: where it is now, and how slowly it follows the ring. */
export type Lamp = Readonly<{
  /** Where it hangs at this moment. */
  at: Eye;
  /** Its own time constant, in seconds. */
  lag: number;
}>;

/**
 * The place on the ring that belongs to one lamp.
 *
 * Every lamp hangs at the ring's elevation and takes an even share of the way
 * around it, so the formation they settle into is regular however the pointer
 * has turned it.
 */
const slotAt = (at: number, count: number, orbit: Orbit, radius: number): Eye =>
  eyeAt(
    {
      azimuth: orbit.azimuth + (at * 2 * Math.PI) / Math.max(count, 1),
      elevation: orbit.elevation,
    },
    radius,
  );

/**
 * Where `count` lamps stand once the ring has been turned this far.
 *
 * Evenly spaced, all at the same height, and that height is above the floor
 * for any orbit — which is the whole reason the room is lit from a ring rather
 * than from arbitrary points.
 */
export const ringAt = (
  count: number,
  orbit: Orbit,
  radius: number,
): readonly Eye[] =>
  Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, at) =>
    slotAt(at, count, orbit, radius),
  );

/**
 * The lamps sitting exactly on their places, in formation.
 *
 * Where a room starts, before anything has been pointed at.
 */
export const restingAt = (
  lags: readonly number[],
  orbit: Orbit,
  radius: number,
): readonly Lamp[] =>
  lags.map((lag, at) => ({ at: slotAt(at, lags.length, orbit, radius), lag }));

/**
 * One frame of every lamp traveling toward its own place on the turned ring.
 *
 * Each lamp keeps its lag, so the same lamp is always the quick one and the
 * formation comes apart the same way every time.
 */
export const lagged = (
  lamps: readonly Lamp[],
  orbit: Orbit,
  radius: number,
  elapsedSeconds: number,
): readonly Lamp[] =>
  lamps.map((lamp, at) => {
    const slot = slotAt(at, lamps.length, orbit, radius);

    return {
      at: {
        x: toward(lamp.at.x, slot.x, elapsedSeconds, lamp.lag),
        y: toward(lamp.at.y, slot.y, elapsedSeconds, lamp.lag),
        z: toward(lamp.at.z, slot.z, elapsedSeconds, lamp.lag),
      },
      lag: lamp.lag,
    };
  });

/** Whether every lamp is back in formation, and the frame loop can stop. */
export const formed = (
  lamps: readonly Lamp[],
  orbit: Orbit,
  radius: number,
): boolean =>
  lamps.every((lamp, at) => {
    const slot = slotAt(at, lamps.length, orbit, radius);

    return (
      arrived(lamp.at.x, slot.x, SETTLED_UNITS) &&
      arrived(lamp.at.y, slot.y, SETTLED_UNITS) &&
      arrived(lamp.at.z, slot.z, SETTLED_UNITS)
    );
  });
