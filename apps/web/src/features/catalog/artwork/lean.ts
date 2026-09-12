/**
 * How the phone is being held, as a place on the stage.
 *
 * A phone that can tell which way is down steers a stage the way a pointer
 * does: it reads as a place on the stage, and the stage turns toward it. What
 * is read is how far down has moved across the screen since the phone was
 * last held still, so a stage answers a tilt and not the angle the phone
 * happens to be held at. A phone lying flat on a table and one held up in
 * front of a face both start square on, and a phone held at a new angle
 * brings its stages back to square over a few seconds.
 *
 * The picture holds still in the room while the phone moves around it: the
 * edge of the phone that comes up toward the viewer is the edge of the stage
 * that reads as pointed at, and a stage sends the edge under the pointer back.
 *
 * Pure: readings go in, places come out, and nothing here listens for them.
 */

import { toward } from "./ease.ts";
import { withinStage, type Offset } from "./pointer.ts";

/** What `deviceorientation` reports, in degrees. */
export type Reading = Readonly<{
  /** Front to back: 0 lying flat, 90 standing upright facing the viewer. */
  beta: number;
  /** Side to side: positive as the right edge dips. */
  gamma: number;
}>;

/**
 * Which way down falls across the phone's screen, as the share of gravity
 * that runs along each of its edges, from -1 to 1.
 *
 * In the phone's own axes: `x` toward its right edge and `y` toward its top
 * edge. What is left of gravity goes through the glass.
 */
export type Fall = Readonly<{ x: number; y: number }>;

const RADIANS = Math.PI / 180;

/**
 * How far down has to move across the screen for a stage to read as pointed
 * at its edge, as a share of gravity.
 *
 * About fifteen degrees of tilt on a phone held up to be read.
 */
const REACH = 0.25;

/**
 * Seconds in which about 63% of the way to a new way of holding the phone is
 * taken as how it is held.
 *
 * Slow against a stage's own movement, so a tilt is answered first and let go
 * of after.
 */
export const HOLD_SECONDS = 2;

/**
 * The least a lean has to change by, on either axis, to be passed on.
 *
 * A hand is never still, and a phone reports it many times a second. Below
 * this the change is the hand rather than a tilt, and passing it on would
 * redraw every stage on screen on every report.
 */
export const LEAN_STEP = 0.01;

/**
 * Which way down falls across the screen, for one reading.
 *
 * Continuous at every angle, including standing upright, where the side to
 * side angle a phone reports stops meaning anything.
 */
export const fallOf = ({ beta, gamma }: Reading): Fall => ({
  x: Math.sin(gamma * RADIANS) * Math.cos(beta * RADIANS),
  y: -Math.sin(beta * RADIANS),
});

/**
 * How the phone is taken to be held, after one more reading.
 *
 * Walks toward `fall` at `HOLD_SECONDS`, and framerate-independent in the way
 * a stage's own movement is: two readings half as far apart in time get as far
 * as one.
 */
export const heldAfter = (held: Fall, fall: Fall, elapsedSeconds: number): Fall => ({
  x: toward(held.x, fall.x, elapsedSeconds, HOLD_SECONDS),
  y: toward(held.y, fall.y, elapsedSeconds, HOLD_SECONDS),
});

/**
 * Where on a stage the phone points, read as `offsetIn` reads a pointer.
 *
 * `fall` is how down falls now and `held` how it falls the way the phone is
 * held, so a phone held the way it is held points at the middle. `screenDegrees`
 * is how far the page is turned from the phone's own upright, as
 * `screen.orientation.angle` reports it, so a tilt reads along the page's own
 * width and height whichever way up the phone is.
 */
export const leanOf = (fall: Fall, held: Fall, screenDegrees: number): Offset => {
  const x = fall.x - held.x;
  const y = fall.y - held.y;
  const turn = screenDegrees * RADIANS;

  // How far down has moved along the page's width and toward its bottom.
  const across = x * Math.cos(turn) - y * Math.sin(turn);
  const down = -x * Math.sin(turn) - y * Math.cos(turn);

  // Down moving toward an edge is that edge dipping away, and the edge read
  // as pointed at is the one coming up.
  return withinStage({ across: -across / REACH, down: -down / REACH });
};

/** Whether `lean` has moved far enough from `last` to be passed on. */
export const movedFrom = (last: Offset, lean: Offset): boolean =>
  Math.abs(lean.across - last.across) >= LEAN_STEP ||
  Math.abs(lean.down - last.down) >= LEAN_STEP;
