/**
 * How the mesh every finisher is demonstrated on sits, and how a place on the
 * floor of a walled room is written.
 *
 * World units throughout, one unit being one width of the mesh at full size.
 * Nothing here knows what the mesh looks like — only how far it reaches, and
 * how it lies once it has been tilted back onto the floor. Pure.
 */

/**
 * How far the mesh reaches from its own middle, at full size.
 *
 * The furthest any vertex of the vendored geometry lies from the origin,
 * rounded up. A subject is turned and tilted about that origin and a rotation
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
 * How far the lowest point of the mesh is below its own middle once it is
 * lying at `RESTING_TILT`, at full size.
 *
 * What a subject is lifted by, scaled by how big it is, so it rests on the
 * floor rather than sinking into it or floating above it. Measured off the
 * vendored geometry.
 */
export const STANDING_DROP = 0.5051301503303207;

/**
 * How high the middle of a subject stands above the floor, at full size.
 *
 * Half the height of the vendored mesh once it is lying at `RESTING_TILT`.
 * What a room aims its eye at, scaled by how big the subject it is aimed at
 * is: a frame centered here holds as much of that subject above its middle as
 * below.
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
export const seenFrom = (
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
