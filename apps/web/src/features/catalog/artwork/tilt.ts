/**
 * Where the pointer is, as an angle for the slab to stand at.
 *
 * The only thing that ever moves in the scene is the slab's own rotation, so
 * this is the whole of the interaction: a position inside the stage becomes two
 * angles, and the angles walk toward that target over a few frames rather than
 * snapping to it.
 *
 * Radians, in the sense `Object3D.rotation` wants them, because that is the
 * only consumer.
 */

/** A position inside the stage, measured from its top-left corner. */
export type Point = Readonly<{ x: number; y: number }>;

/** How big the stage is on screen. Only the ratio of the two ever matters. */
export type Size = Readonly<{ width: number; height: number }>;

/** How far the slab is turned about each axis, in radians. */
export type Tilt = Readonly<{ x: number; y: number }>;

/** Square on to the camera, which is where the slab sits when nobody points. */
export const REST: Tilt = { x: 0, y: 0 };

/** How far the slab turns once the pointer reaches the edge of the stage. */
const MAX_TILT_RADIANS = (13 * Math.PI) / 180;

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

/**
 * JavaScript has two zeroes and multiplying the positive one by a negative
 * yields the negative one. Nothing downstream wants to be told that a slab
 * dead center is turned by minus nothing.
 */
const unsigned = (value: number): number => (value === 0 ? 0 : value);

/**
 * The angle the slab stands at while the pointer is here.
 *
 * The edge under the pointer is the edge that recedes, which is the gesture of
 * pressing a corner rather than of dragging one. A stage with no width or no
 * height has no center to measure from, so it has nowhere to turn.
 */
export const tiltAt = (pointer: Point, stage: Size): Tilt => {
  const halfWidth = stage.width / 2;
  const halfHeight = stage.height / 2;

  if (halfWidth <= 0 || halfHeight <= 0) return REST;

  const across = clampUnit((pointer.x - halfWidth) / halfWidth);
  const down = clampUnit((pointer.y - halfHeight) / halfHeight);

  // Positive `rotation.y` takes the right edge back; positive `rotation.x`
  // brings the top edge forward, so `down` carries its own sign into it.
  return {
    x: unsigned(down * MAX_TILT_RADIANS),
    y: unsigned(across * MAX_TILT_RADIANS),
  };
};

/**
 * Seconds in which the slab covers about 63% of the angle left to cover.
 *
 * Exponential rather than a fixed duration because the target moves under the
 * pointer: a tween would have to be restarted on every mouse event, and a
 * restarted tween is a slab that never gets anywhere.
 */
const SETTLE_SECONDS = 0.085;

/** Below this the remaining angle is under a twentieth of a degree. */
const SETTLED_RADIANS = 0.0008;

/**
 * One frame of the slab traveling toward where the pointer wants it.
 *
 * Framerate-independent: the fraction covered is derived from the time the
 * frame actually took, so a slow frame moves further rather than slower.
 */
export const approach = (
  current: Tilt,
  target: Tilt,
  elapsedSeconds: number,
): Tilt => {
  const covered = 1 - Math.exp(-Math.max(0, elapsedSeconds) / SETTLE_SECONDS);

  return {
    x: current.x + (target.x - current.x) * covered,
    y: current.y + (target.y - current.y) * covered,
  };
};

/**
 * Whether the slab has arrived, and the frame loop can stop.
 *
 * Exponential approach never actually reaches its target, so something has to
 * decide when the difference has stopped being a difference.
 */
export const settled = (current: Tilt, target: Tilt): boolean =>
  Math.abs(target.x - current.x) < SETTLED_RADIANS &&
  Math.abs(target.y - current.y) < SETTLED_RADIANS;
