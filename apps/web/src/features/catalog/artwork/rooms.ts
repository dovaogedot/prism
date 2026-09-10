/**
 * How big each finisher's room is, and where its eye stands in it.
 *
 * A room is built around the arrangement standing in it: how much floor that
 * arrangement covers decides how far back the walls go, how far the eye stands
 * to fit it in the frame, and how wide the ring of lamps is that circles it.
 * All of it is arithmetic on one number per room, so a room cannot end up
 * framed for an arrangement it is not showing.
 *
 * World units throughout, one unit being one width of the mesh at full size.
 */

import {
  CORNER_BEARING,
  frontOf,
  MESH_REACH,
  reachOf,
  STANDING_IN,
  STANDING_MIDDLE,
} from "./arrangement.ts";
import { ELEVATION_BOUNDS, type Orbit, REST_ORBIT, turnedBy } from "./orbit.ts";

/** How much floor each room's arrangement needs, from its own middle. */
export const REACH = {
  roughness: reachOf(STANDING_IN.roughness),
  emission: reachOf(STANDING_IN.emission),
  coating: reachOf(STANDING_IN.coating),
} as const;

/**
 * How wide a lens each room is seen through, in degrees.
 *
 * The two rooms with a subject near the eye are seen through a wide one. A
 * long lens has to stand back to fit the same shape in the frame, and from
 * back there the shape flattens into a card — while what a finish does to a
 * surface is read from how that surface turns away from the light. The glowing
 * room keeps the long lens: it is looked at from across a dark floor, and its
 * three subjects have to hold their sizes as the eye walks around them.
 */
export const FIELD_OF_VIEW = { roughness: 52, emission: 34, coating: 50 } as const;

/** Half of a lens's angle, in radians, which is what every framing is solved on. */
const halfLens = (fieldOfView: number): number => (fieldOfView * Math.PI) / 360;

/** How far back an eye stands to fit a sphere of this radius in this lens. */
export const distanceFor = (framed: number, fieldOfView: number): number =>
  framed / Math.tan(halfLens(fieldOfView));

/**
 * How much of the frame the near subject of a coated room is given.
 *
 * Of the half frame, and of a sphere that would hold the whole mesh — the head
 * lying inside that sphere is a good deal smaller than it, so this is short of
 * one and the subject still stops well inside the picture. What a coating
 * shows depends on the angle each patch of it is seen at, so the frame is
 * spent on one subject seen large enough for that angle to sweep across it.
 */
const COATED_SHARE = 0.84;

/** The subject a coated room is framed on, which is the one nearest the eye. */
const COATED_FRONT = frontOf(STANDING_IN.coating);

/**
 * How far the eye stands from the middle of each room.
 *
 * A stage is square, so one framed radius covers both directions. The coated
 * room is measured off its near subject rather than off the whole arrangement:
 * that subject is what is being shown, and it stands in front of the middle,
 * so framing the arrangement puts it further away than it needs to be. The
 * roughness room frames a little wider than its one subject, and the glowing
 * room wider than its arrangement, because that arrangement is nearly flat and
 * never fills the frame the way its radius suggests.
 */
export const EYE_DISTANCE = {
  roughness: distanceFor(REACH.roughness * 1.25, FIELD_OF_VIEW.roughness),
  emission: distanceFor(REACH.emission * 0.95, FIELD_OF_VIEW.emission),
  coating:
    COATED_FRONT.toward +
    distanceFor(COATED_FRONT.reach / COATED_SHARE, FIELD_OF_VIEW.coating),
} as const;

/**
 * How far the eye orbits from the middle of a glowing room.
 *
 * Read by the stage, which turns the pointer into an orbit at this radius.
 */
export const EYE_RADIUS = EYE_DISTANCE.emission;

/** How high the middle of a subject that reaches this far off its own axis is. */
const middleOf = (reach: number): number => (STANDING_MIDDLE * reach) / MESH_REACH;

/**
 * How high the eye stands, and the height it looks at, in each room.
 *
 * Every room looks at the middle of the subject nearest its eye, so what it is
 * being shown sits in the middle of the frame. The eyes themselves stand a
 * little above that, high enough to see the floor a subject stands on and low
 * enough to see it across its own curve rather than down onto its head. The
 * glowing room has no height of its own: its eye orbits, so where it stands is
 * whatever the orbit puts it at, and only what it looks at is fixed.
 */
export const EYE_HEIGHT = {
  roughness: {
    stands: 1.05,
    looksAt: middleOf(frontOf(STANDING_IN.roughness).reach),
  },
  emission: { looksAt: middleOf(frontOf(STANDING_IN.emission).reach) },
  coating: { stands: 0.52, looksAt: middleOf(COATED_FRONT.reach) },
} as const;

/**
 * How far a corner's ring of lamps hangs from the middle of that corner.
 *
 * Outside the deepest arrangement a corner stands, so no lamp on the ring ever
 * ends up inside a subject, and inside the walls at every elevation the
 * pointer can carry the ring to — a lamp behind a wall lights the back of it,
 * and the back of a wall is the side the room cannot see. Both corners hang
 * their ring at this one radius.
 */
export const LAMP_RADIUS = 3;

/**
 * Where a corner's ring of lamps rests.
 *
 * Turned onto the bearing the corner is looked into from, which puts one lamp
 * over the reader's shoulder and lights what they are looking at. A roughness
 * room's pointer turns the whole ring away from here; a coated room's leaves
 * it where it is.
 */
export const RING_AT_REST: Orbit = turnedBy(REST_ORBIT, CORNER_BEARING);

/**
 * How far behind the middle the two walls of a corner stand.
 *
 * Behind the deepest of the arrangements the corners stand, so that one
 * distance holds for both of them. It is what makes the two corners one room:
 * a lamp is only as bright on a wall as it is far from it, so two corners that
 * agree on every lamp and not on where their walls are do not agree on the
 * picture either.
 */
export const WALL_AT = Math.max(REACH.roughness, REACH.coating) * 1.9;

/**
 * How far the floor and walls run, as a multiple of how far back they stand.
 *
 * Generous, because the alternative is an edge in the frame: a wall that stops
 * inside the picture is a panel standing in a void rather than a room.
 */
export const ROOM_EXTENT = 6;

/** How far the floor of the open room runs from the middle of it. */
const OPEN_RADIUS = REACH.emission * 9;

/** How much taller than the frame the open room's wall is built. */
const OPEN_MARGIN = 1.2;

/**
 * Where the floor of the open room begins to fade, and where it has gone.
 *
 * The far end is inside the nearest the floor's own edge can come to the eye,
 * whichever way the eye has walked around it, so the floor has faded into the
 * color of the room before it stops. A floor that stops inside the picture is
 * a disc lying in the dark; one that fades has no end in the picture at all.
 */
export const OPEN_FOG = {
  near: EYE_RADIUS,
  far: (OPEN_RADIUS - EYE_RADIUS) * 0.9,
} as const;

/**
 * The floor a glow is demonstrated on, and the wall that closes it.
 *
 * The room has no wall near enough to be lit by what stands in it — a wall
 * that close reports the glow instead of the subject — but it is closed all
 * the same. A floor that stops has an edge, and an eye lowered toward the
 * height of what it is looking at sees over that edge into nothing. The wall
 * stands far enough out to stay dark and rises past the top of the frame from
 * the lowest the eye can be put, which is where the frame reaches highest.
 */
export const OPEN_ROOM = {
  radius: OPEN_RADIUS,
  height:
    OPEN_MARGIN *
    (EYE_HEIGHT.emission.looksAt +
      EYE_RADIUS * Math.sin(ELEVATION_BOUNDS.lowest) +
      (OPEN_RADIUS + EYE_RADIUS) *
        Math.tan(halfLens(FIELD_OF_VIEW.emission) - ELEVATION_BOUNDS.lowest)),
} as const;
