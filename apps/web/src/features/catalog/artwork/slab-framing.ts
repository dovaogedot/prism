/**
 * Where a color's slab is looked at from, and the wall it stands in front of.
 *
 * Slab widths throughout. Pure, so what the eye can see from any viewpoint
 * can be checked without a scene to build.
 */

import type { Gaze } from "./viewpoint.ts";

/** How far the camera stands back, in slab widths. A long lens on a product. */
const CAMERA_DISTANCE = 3.9;

/** The lens the slab is seen through at rest, in degrees. */
export const FIELD_OF_VIEW = 26;

/**
 * Where the slab's eye rests, straight in front of it, and what it looks at
 * and walks around: the middle of the slab.
 */
export const SLAB_GAZE: Gaze = {
  eye: { x: 0, y: 0, z: CAMERA_DISTANCE },
  target: { x: 0, y: 0, z: 0 },
  pivot: { x: 0, y: 0, z: 0 },
};

/**
 * How far the wall is behind the slab.
 *
 * Close, because the shadow lands on it: a wall further back takes the shadow
 * out of the picture with it and leaves the slab floating in front of nothing.
 */
export const WALL_DISTANCE = 0.36;

/** Comfortably wider than the frame at the wall's depth, from every viewpoint a still is taken from. */
export const WALL_SIZE = 5;
