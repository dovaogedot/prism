/**
 * How far around the wheel a coating's colors have been carried.
 *
 * An interference coating has no color of its own — what comes back off it is
 * decided by the angle it is seen at, which is why a coated panel changes hue
 * as you walk past it. On a stage nobody can walk past, the pointer stands in
 * for the walk: crossing the stage carries every color in the room right
 * around the wheel and back to where it started.
 *
 * Degrees, because a hue is degrees.
 */

import { SETTLED_RADIANS } from "./ease.ts";
import { type Point, type Size } from "./pointer.ts";

/** One turn of the wheel, which is what crossing the stage is worth. */
const FULL_TURN = 360;

/**
 * How far the wheel has been carried, with the pointer here.
 *
 * Zero at the left edge, growing to a full turn at the right — so both edges
 * show the same colors, and there is no seam to cross. A stage with no width
 * has no distance to travel across.
 */
export const hueOffsetAt = (pointer: Point, stage: Size): number => {
  if (stage.width <= 0) return 0;

  const across = Math.max(0, Math.min(1, pointer.x / stage.width));

  return across * FULL_TURN;
};

/** A hue carried by an offset, brought back inside one turn of the wheel. */
export const hueShifted = (hue: number, offset: number): number => {
  const carried = (hue + offset) % FULL_TURN;

  return carried < 0 ? carried + FULL_TURN : carried;
};

/**
 * How near its target a hue has to be to count as having arrived, in degrees.
 *
 * The same distance `SETTLED_RADIANS` calls arrived, in the unit a hue is
 * measured in: a wheel of 360 degrees and a circle of 2π radians are the same
 * circle, and a stage that stopped at a different point on one of them would
 * settle in a visibly different length of time.
 */
export const SETTLED_DEGREES = (SETTLED_RADIANS * 180) / Math.PI;

/**
 * The nearest offset that shows the colors an uncarried room shows.
 *
 * A wheel has no far side: carrying every hue a full turn leaves all of them
 * where they were. So a room let go of near the end of its turn finishes the
 * turn rather than unwinding the whole of it, and one let go of near the start
 * unwinds — the short way either way, and the same colors at the end of it.
 */
export const unturned = (offset: number): number =>
  Math.round(offset / FULL_TURN) * FULL_TURN;
