/**
 * Where the eye stands, as the pointer moves over the stage.
 *
 * A finisher's room is looked around rather than turned: the subjects stay
 * where they were placed and the camera walks along a circle at a fixed
 * distance from them. Two angles are the whole of that walk, and the distance
 * is whatever the scene wants — which is why the position is worked out from
 * the two only at the moment something needs one.
 *
 * Radians, and the elevation is measured up from the floor.
 */

import { arrived, SETTLE_SECONDS, SETTLED_RADIANS, toward } from "./ease.ts";
import { offsetIn, type Point, type Size } from "./pointer.ts";

/** Where the eye is on its circle: around, and up from the floor. */
export type Orbit = Readonly<{
  /** Around the vertical axis, zero being straight in front. */
  azimuth: number;
  /** Up from the floor. Always above it, so the room is never seen from below. */
  elevation: number;
}>;

/** A position in the room. */
export type Eye = Readonly<{ x: number; y: number; z: number }>;

/** How far around the eye travels once the pointer reaches the side. */
const AZIMUTH_REACH = (55 * Math.PI) / 180;

/**
 * How high the eye stands with the pointer in the middle of the stage.
 *
 * Low, because a room is read from inside it: an eye further up looks down at
 * a floor plan and loses the walls, which are what the light comes off.
 */
const ELEVATION_REST = (23 * Math.PI) / 180;

/**
 * How far up and down from that the pointer carries it.
 *
 * Under the rest elevation, which is what keeps the eye above the floor at
 * every position the pointer can reach.
 */
const ELEVATION_REACH = (19 * Math.PI) / 180;

/** Straight in front and a little above, where a stage nobody points at sits. */
export const REST_ORBIT: Orbit = { azimuth: 0, elevation: ELEVATION_REST };

/**
 * How high and how low the pointer can put the eye, in radians from the floor.
 *
 * Both above the floor, so a room is never seen from underneath. A room built
 * to be closed at every angle is built against `lowest`, where the eye is
 * nearest level and the frame reaches furthest up the far side.
 */
export const ELEVATION_BOUNDS = {
  lowest: ELEVATION_REST - ELEVATION_REACH,
  highest: ELEVATION_REST + ELEVATION_REACH,
} as const;

/**
 * The same orbit, turned around the vertical axis.
 *
 * What a room composed for one bearing does with an orbit measured from
 * straight ahead: the pointer says how far around from the middle, and this
 * says where the middle of that room is.
 */
export const turnedBy = (orbit: Orbit, bearing: number): Orbit => ({
  azimuth: orbit.azimuth + bearing,
  elevation: orbit.elevation,
});

/**
 * Where the pointer asks the eye to stand.
 *
 * Pushing the pointer up raises the eye, which is the gesture of lifting the
 * whole room to look under it.
 */
export const orbitAt = (pointer: Point, stage: Size): Orbit => {
  const { across, down } = offsetIn(pointer, stage);

  return {
    azimuth: across * AZIMUTH_REACH,
    elevation: ELEVATION_REST - down * ELEVATION_REACH,
  };
};

/**
 * The position an orbit names, at a given distance from what it looks at.
 *
 * The distance survives: whatever the two angles are, the result is exactly
 * `radius` away from the middle of the room.
 */
export const eyeAt = (orbit: Orbit, radius: number): Eye => {
  const flat = radius * Math.cos(orbit.elevation);

  return {
    x: flat * Math.sin(orbit.azimuth),
    y: radius * Math.sin(orbit.elevation),
    z: flat * Math.cos(orbit.azimuth),
  };
};

/** One frame of the eye traveling toward where the pointer wants it. */
export const approachOrbit = (
  current: Orbit,
  target: Orbit,
  elapsedSeconds: number,
): Orbit => ({
  azimuth: toward(current.azimuth, target.azimuth, elapsedSeconds, SETTLE_SECONDS),
  elevation: toward(current.elevation, target.elevation, elapsedSeconds, SETTLE_SECONDS),
});

/** Whether the eye has arrived, and the frame loop can stop. */
export const orbitSettled = (current: Orbit, target: Orbit): boolean =>
  arrived(current.azimuth, target.azimuth, SETTLED_RADIANS) &&
  arrived(current.elevation, target.elevation, SETTLED_RADIANS);
