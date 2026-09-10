/**
 * Where a scene is looked at from.
 *
 * Every scene has one place its eye stands before anybody points at it, and
 * that is where a live stage looks from. A still may be taken from a step
 * around it instead: the eye walks around what it is looking at, keeping the
 * distance it stood at, and may rise. Two angles are the whole of that step.
 *
 * Pure, and radians throughout.
 */

import type { StillAngle } from "@prism/shared";
import { eyeAt, type Eye } from "./orbit.ts";

/** How far the eye has walked from where it stands at rest. */
export type Viewpoint = Readonly<{
  /** Around the vertical line through what it looks at; positive is to the eye's right. */
  around: number;
  /** Up, added to the angle it already looks down from. */
  up: number;
}>;

/** Where the eye stands before anybody points at the scene. */
export const AT_REST: Viewpoint = { around: 0, up: 0 };

/** The viewpoint one of a product's stills is taken from. */
export const viewpointOf = (angle: StillAngle): Viewpoint => ({
  around: (angle.aroundDegrees * Math.PI) / 180,
  up: (angle.upDegrees * Math.PI) / 180,
});

/**
 * Where an eye that stands at `rest` looking at `target` stands at `viewpoint`.
 *
 * It stays exactly as far from the target as it was, and at `AT_REST` it
 * stands where it stood.
 */
export const eyeFrom = (rest: Eye, target: Eye, viewpoint: Viewpoint): Eye => {
  const x = rest.x - target.x;
  const y = rest.y - target.y;
  const z = rest.z - target.z;
  const flat = Math.hypot(x, z);

  const moved = eyeAt(
    {
      azimuth: Math.atan2(x, z) + viewpoint.around,
      elevation: Math.atan2(y, flat) + viewpoint.up,
    },
    Math.hypot(flat, y),
  );

  return { x: target.x + moved.x, y: target.y + moved.y, z: target.z + moved.z };
};
