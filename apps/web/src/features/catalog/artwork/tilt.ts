/**
 * Where the pointer is, as an angle for the slab to stand at.
 *
 * The only thing that ever moves in the color scene is the slab's own
 * rotation, so this is the whole of the interaction: a position inside the
 * stage becomes two angles, and the angles walk toward that target over a few
 * frames rather than snapping to it.
 *
 * Radians, in the sense `Object3D.rotation` wants them, because that is the
 * only consumer.
 */

import { arrived, SETTLE_SECONDS, SETTLED_RADIANS, toward } from "./ease.ts";
import { offsetIn, type Point, type Size } from "./pointer.ts";

/** How far the slab is turned about each axis, in radians. */
export type Tilt = Readonly<{ x: number; y: number }>;

/** Square on to the camera, which is where the slab sits when nobody points. */
export const REST: Tilt = { x: 0, y: 0 };

/** How far the slab turns once the pointer reaches the edge of the stage. */
const MAX_TILT_RADIANS = (13 * Math.PI) / 180;

/**
 * The angle the slab stands at while the pointer is here.
 *
 * The edge under the pointer is the edge that recedes, which is the gesture of
 * pressing a corner rather than of dragging one.
 */
export const tiltAt = (pointer: Point, stage: Size): Tilt => {
  const { across, down } = offsetIn(pointer, stage);

  // Positive `rotation.y` takes the right edge back; positive `rotation.x`
  // brings the top edge forward, so `down` carries its own sign into it.
  return { x: down * MAX_TILT_RADIANS, y: across * MAX_TILT_RADIANS };
};

/** One frame of the slab traveling toward where the pointer wants it. */
export const approach = (
  current: Tilt,
  target: Tilt,
  elapsedSeconds: number,
): Tilt => ({
  x: toward(current.x, target.x, elapsedSeconds, SETTLE_SECONDS),
  y: toward(current.y, target.y, elapsedSeconds, SETTLE_SECONDS),
});

/** Whether the slab has arrived, and the frame loop can stop. */
export const settled = (current: Tilt, target: Tilt): boolean =>
  arrived(current.x, target.x, SETTLED_RADIANS) &&
  arrived(current.y, target.y, SETTLED_RADIANS);
