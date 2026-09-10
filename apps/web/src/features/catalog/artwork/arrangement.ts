/**
 * Where the subjects of a finisher's room stand, and what they are painted.
 *
 * Each of the three rooms has one arrangement and one set of hues, and keeps
 * both. Every finisher that applies the same thing is demonstrated on the same
 * shapes standing in the same places at the same sizes wearing the same paint,
 * so what a shopper sees differing between two of them is the finish and
 * nothing else.
 *
 * World units throughout, one unit being one width of the mesh at full size.
 * Nothing here knows what the mesh is — only how much floor one of them takes.
 */

import type { FinishApplication } from "@prism/shared";

/**
 * How far the mesh reaches from its own middle, at full size.
 *
 * The furthest any vertex of the vendored geometry lies from the origin, which
 * is 1.44874. A subject is turned and tilted about that origin and a rotation
 * moves no vertex further from it, so two subjects further apart than the sum
 * of their reaches cannot touch, however either of them is standing.
 */
export const MESH_REACH = 1.4488;

/**
 * How far back a subject lies, in radians about its own left-right axis.
 *
 * The one tilt that puts two points of the mesh on the floor at once: at 35.61
 * degrees back the chin and the back of the head are level with each other and
 * everything between them is clear of the floor. Either side of it the subject
 * rests on one of the two alone — further back and it rolls onto the back of
 * the head, less and it stands on the chin — so this is where it lies rather
 * than leans, with the face turned up at whoever is looking into the room.
 */
export const RESTING_TILT = -0.6215;

/**
 * How high the middle of a subject stands above the floor, at full size.
 *
 * Half the height of the vendored mesh once it is lying at `RESTING_TILT`,
 * which is 0.7619. What a room aims its eye at, scaled by how big the subject
 * it is aimed at is: a frame centered here holds as much of that subject above
 * its middle as below.
 */
export const STANDING_MIDDLE = 0.7619;

/**
 * The bearing the two walled rooms are looked into from.
 *
 * The diagonal between the two walls, which is the one line from which both of
 * them are equally in the picture and the seam between them runs down the
 * middle of it. Everything composed for those rooms — where a subject stands,
 * which way it faces, where the lamps rest — is measured from here.
 */
export const CORNER_BEARING = Math.PI / 4;

/** Where one subject stands, and how it is standing there. */
export type Placement = Readonly<{
  /** Across the floor, from the middle of the arrangement. */
  x: number;
  /** Toward the camera, from the middle of the arrangement. */
  z: number;
  /** How big, as a multiple of the mesh's own size. */
  scale: number;
  /** How far it is turned about the vertical axis, in radians. */
  turn: number;
}>;

/**
 * How far in front of the middle of the floor a subject stands.
 *
 * Along the line from the middle of a walled room to the eye looking into it,
 * so a subject nearer the eye than the middle answers positive and one behind
 * it answers negative. The measurement a walled arrangement is composed on.
 */
export const towardOf = (at: Placement): number => (at.x + at.z) * Math.SQRT1_2;

/**
 * A placement in a walled room, given the way the eye sees it.
 *
 * `toward` is how far in front of the middle of the floor the subject stands,
 * along the line from the middle to the eye, and `aside` is how far to the
 * right of that line. `facing` is how far it is turned away from facing the
 * eye. Writing them this way is what keeps a room composed: a subject standing
 * in front of another is on neither axis of the floor, and the numbers still
 * say which is in front.
 */
const seenFrom = (
  toward: number,
  aside: number,
  scale: number,
  facing: number,
): Placement => ({
  x: (toward + aside) * Math.SQRT1_2,
  z: (toward - aside) * Math.SQRT1_2,
  scale,
  turn: CORNER_BEARING + facing,
});

/**
 * The arrangement each room stands, by what its finishers apply to.
 *
 * One subject for a grain, because a grain is read from a single highlight
 * traveling over a single surface and a second shape only splits the reading.
 * Three for a glow, close enough that the pool each of them lays on the floor
 * runs into the pools of the other two. Two for a coating, one of them near the eye and one behind it
 * and to the side, so the film's colors are seen over two curvatures and at
 * two distances at once.
 */
export const STANDING_IN: Readonly<
  Record<FinishApplication["applies"], readonly Placement[]>
> = {
  roughness: [seenFrom(0, 0, 0.5, 0.24)],
  // Each turned to face roughly where the eye rests, and each by a different
  // amount, so at rest all three faces are readable and none of them is the
  // same three-quarter view as its neighbor.
  emission: [
    { x: 0.58, z: 0.92, scale: 0.44, turn: 0.18 },
    { x: -0.95, z: 0.12, scale: 0.4, turn: -0.12 },
    { x: 0.28, z: -1.06, scale: 0.47, turn: 0.34 },
  ],
  coating: [seenFrom(0.85, 0.02, 0.52, 0.5), seenFrom(-0.75, 0.7, 0.46, -0.95)],
};

/**
 * The hues a glowing room paints its subjects, in degrees around the wheel.
 *
 * Cyan, magenta and yellow. Each of the three is two of the display's channels
 * at once, so each carries more light for the same paint than a red, a green
 * or a blue does — and what is being demonstrated is light coming off a
 * surface. Fixed rather than drawn from the product, because the three of them
 * together are the demonstration: one pigment glowing tells a shopper what a
 * glow costs on that hue, and three across the wheel tell them it costs the
 * same on any of them.
 */
export const GLOWING_HUES: readonly number[] = [180, 300, 60];

/**
 * The hues a coated room paints its subjects, in degrees around the wheel.
 *
 * A film's colors are added to whatever is under them, so what a base hue does
 * is decide which of them survive: the film's own returns near that hue are
 * lost in it and the ones across the wheel from it are strongest. A deep blue
 * and an amber, which are across the wheel from each other — so between the
 * two subjects both halves of what the film returns are shown against paint
 * that is not already that color. Of the pairs measured, this one leaves the
 * most tenths of the wheel colored on the worst product on the shelf.
 */
export const COATED_HUES: readonly number[] = [225, 45];

/** The subject of an arrangement that stands nearest the eye. */
export type Front = Readonly<{
  /** How far in front of the middle of the floor it stands. */
  toward: number;
  /** How far it reaches from its own middle, at the size it stands. */
  reach: number;
}>;

/**
 * The subject an arrangement puts nearest the eye.
 *
 * What a walled room is framed on: the near subject is the one the shopper is
 * being shown, and the rest of the arrangement is what it is standing in. An
 * arrangement with nothing in it stands nobody in front of the middle and
 * reaches nowhere.
 */
export const frontOf = (placements: readonly Placement[]): Front =>
  placements.reduce<Front>(
    (front, at, index) => {
      const toward = towardOf(at);

      return index === 0 || toward > front.toward
        ? { toward, reach: MESH_REACH * at.scale }
        : front;
    },
    { toward: 0, reach: 0 },
  );

/**
 * How far an arrangement reaches from its own middle.
 *
 * What a floor has to cover for every subject in it to stand on it, and what
 * an eye has to frame to have all of them in the picture. An arrangement with
 * nothing in it reaches nowhere.
 */
export const reachOf = (placements: readonly Placement[]): number =>
  placements.reduce(
    (most, at) => Math.max(most, Math.hypot(at.x, at.z) + MESH_REACH * at.scale),
    0,
  );

/** How a shape sits on the floor once it has been tilted back. */
export type Resting = Readonly<{
  /** How far its lowest point is below its own middle, at full size. */
  drop: number;
  /** How far its furthest point is from the vertical axis, at full size. */
  reach: number;
}>;

/**
 * Where a shape's floor and its edge are, once it is lying at this tilt.
 *
 * `positions` is read as triples of x, y and z; a trailing partial triple is
 * ignored. Both results are at full size and scale with the subject. A shape
 * with nothing below its own middle drops by zero rather than by a negative
 * amount, so nothing is ever sunk into the floor.
 */
export const restingOf = (positions: ArrayLike<number>, tilt: number): Resting => {
  const cosine = Math.cos(tilt);
  const sine = Math.sin(tilt);
  let lowest = 0;
  let reach = 0;

  for (let at = 0; at + 2 < positions.length; at += 3) {
    const x = positions[at] ?? 0;
    const y = positions[at + 1] ?? 0;
    const z = positions[at + 2] ?? 0;
    // Turned about the left-right axis, which leaves x where it was and swaps
    // height for depth. The vertical turn that follows it does not move a
    // vertex up or down, so this is the whole of how the shape sits.
    const lifted = y * cosine - z * sine;
    const deep = y * sine + z * cosine;

    lowest = Math.min(lowest, lifted);
    reach = Math.max(reach, Math.hypot(x, deep));
  }

  // Nothing below the middle is no drop at all rather than minus nothing,
  // which is what negating a zero would hand back.
  return { drop: lowest < 0 ? -lowest : 0, reach };
};
