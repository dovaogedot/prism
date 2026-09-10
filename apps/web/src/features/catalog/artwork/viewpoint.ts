/**
 * Where a scene is looked at from, and through what lens.
 *
 * Every scene has one place its eye stands before anybody points at it, and
 * that is where a live stage looks from. A still may be taken from somewhere
 * around it instead: the eye walks around the subject it is showing, may
 * rise, may see through a wider or a longer lens, and stands back as far as
 * that lens and the size it draws its subject at ask.
 *
 * Each product's stills stray from the angles every product shares by an
 * amount drawn from its slug, so no two products' pictures are taken from
 * quite the same places, and the same product's are taken from the same
 * places every time.
 *
 * Pure, and radians throughout.
 */

import type { StillAngle } from "@prism/shared";
import type { Eye } from "./orbit.ts";
import { randomFrom } from "./seeded.ts";

/** How far the eye has walked from where it stands at rest, and what it sees through. */
export type Viewpoint = Readonly<{
  /** Around the vertical line through what it walks around; positive is to the eye's right. */
  around: number;
  /** Up, added to the angle it already looks down from. */
  up: number;
  /** The lens, as a multiple of the field of view the scene rests at. */
  lens: number;
  /** How large what it walks around is drawn, as a multiple of its size at rest. */
  scale: number;
}>;

/** Where the eye stands before anybody points at the scene. */
export const AT_REST: Viewpoint = { around: 0, up: 0, lens: 1, scale: 1 };

/** Where an eye stands, and a point on its line of sight. */
export type Look = Readonly<{ eye: Eye; target: Eye }>;

/**
 * How a scene is looked at before anybody points at it, and what the eye
 * walks around when it strays: the subject the scene is showing.
 *
 * The pivot lies on the upright plane through the eye and its target. That is
 * what lets the eye rise over the pivot without the picture rolling, which a
 * camera held upright would take back out and so move the pivot in the frame.
 */
export type Gaze = Look & Readonly<{ pivot: Eye }>;

/** The least and the most one value may be drawn at. */
type Bounds = Readonly<{ least: number; most: number }>;

/**
 * How far one product's stills stray from the angles every product shares.
 *
 * Around and up are in degrees either side of the angle's own. Up never
 * reaches below where the eye rests, and around stays short of every side
 * angle, so a still said to be seen from the left is. A still never draws its
 * subject larger than it rests: the coated room is framed tight on its near
 * subject, and the head fills nearly the whole frame at rest.
 *
 * How far all four may go together is what keeps every room closed and every
 * coated head whole: `viewpoint.test.ts` checks both from every corner of
 * these bounds.
 */
export const SWAY = {
  aroundDegrees: 10,
  upDegrees: 6,
  lens: { least: 0.8, most: 1.25 },
  scale: { least: 0.8, most: 0.97 },
} as const satisfies Readonly<{
  aroundDegrees: number;
  upDegrees: number;
  lens: Bounds;
  scale: Bounds;
}>;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** FNV-1a, so a slug and an angle's name make one seed that is the same on every machine. */
const seedOf = (text: string): number => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash;
};

/**
 * The viewpoint one still of the product sold as `slug` is taken from.
 *
 * An angle at rest stays at rest, whatever the product: it is the picture the
 * live scene opens on. Every other angle is strayed from within `SWAY`, by an
 * amount that depends on the slug and the angle's name and on nothing else.
 */
export const viewpointOf = (angle: StillAngle, slug: string): Viewpoint => {
  if (angle.aroundDegrees === 0 && angle.upDegrees === 0) return AT_REST;

  const next = randomFrom(seedOf(`${slug}/${angle.name}`));
  const within = (least: number, most: number): number => least + next() * (most - least);

  return {
    around: radians(
      within(angle.aroundDegrees - SWAY.aroundDegrees, angle.aroundDegrees + SWAY.aroundDegrees),
    ),
    up: radians(
      within(Math.max(0, angle.upDegrees - SWAY.upDegrees), angle.upDegrees + SWAY.upDegrees),
    ),
    lens: within(SWAY.lens.least, SWAY.lens.most),
    scale: within(SWAY.scale.least, SWAY.scale.most),
  };
};

/** Half of a lens's angle, in radians. */
const halfLens = (fieldOfView: number): number => (fieldOfView * Math.PI) / 360;

/** The field of view, in degrees, of a scene that rests at `fieldOfView` seen from `viewpoint`. */
export const fieldOfViewAt = (fieldOfView: number, viewpoint: Viewpoint): number =>
  fieldOfView * viewpoint.lens;

/**
 * How far the eye stands from what it walks around, as a multiple of how far it rests.
 *
 * Whatever the lens, what the eye walks around is drawn `viewpoint.scale`
 * times the size it is drawn at rest, so a wider lens brings the eye in and a
 * longer one sends it back.
 */
export const distanceAt = (fieldOfView: number, viewpoint: Viewpoint): number =>
  Math.tan(halfLens(fieldOfView)) /
  (Math.tan(halfLens(fieldOfViewAt(fieldOfView, viewpoint))) * viewpoint.scale);

const UPRIGHT: Eye = { x: 0, y: 1, z: 0 };

const plus = (a: Eye, b: Eye): Eye => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const minus = (a: Eye, b: Eye): Eye => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scaled = (a: Eye, by: number): Eye => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const cross = (a: Eye, b: Eye): Eye => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** `vector` turned by `angle` about the unit `axis`, counterclockwise looking down the axis. */
const turned = (vector: Eye, axis: Eye, angle: number): Eye => {
  const along = axis.x * vector.x + axis.y * vector.y + axis.z * vector.z;

  return plus(
    plus(scaled(vector, Math.cos(angle)), scaled(cross(axis, vector), Math.sin(angle))),
    scaled(axis, along * (1 - Math.cos(angle))),
  );
};

/**
 * Where the eye of a scene that rests at `gaze`, through a lens of
 * `fieldOfView` degrees, stands at `viewpoint`, and which way it looks.
 *
 * The eye and its line of sight turn together about the pivot, so the pivot
 * stays where the resting frame puts it, and the eye stands `distanceAt`
 * times as far from it as it rests. `around` turns about the vertical line
 * through the pivot and `up` raises the eye's own elevation above it by
 * exactly that angle. At `AT_REST` the eye stands and looks where it rests.
 */
export const lookFrom = (gaze: Gaze, viewpoint: Viewpoint, fieldOfView: number): Look => {
  const walked = turned(minus(gaze.eye, gaze.pivot), UPRIGHT, viewpoint.around);
  const sight = turned(minus(gaze.target, gaze.eye), UPRIGHT, viewpoint.around);

  // Horizontal and square to the line from the pivot to the eye, so turning
  // about it lifts the eye straight up over the pivot.
  const flat = Math.hypot(walked.x, walked.z);
  const tilt: Eye = { x: -walked.z / flat, y: 0, z: walked.x / flat };

  const eye = plus(
    gaze.pivot,
    scaled(turned(walked, tilt, viewpoint.up), distanceAt(fieldOfView, viewpoint)),
  );

  return { eye, target: plus(eye, turned(sight, tilt, viewpoint.up)) };
};
