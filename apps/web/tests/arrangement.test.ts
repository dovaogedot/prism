/**
 * Where the subjects of a finisher's room stand, and what they are painted.
 *
 * The arrangements are written by hand and are not allowed to be arbitrary:
 * they have to fit on the floor and they have to leave the subjects clear of
 * each other, whichever way any of them is lying. The hues are written by hand
 * too, and every room has to have one for everybody standing in it.
 */

import { describe, expect, it } from "vitest";
import {
  COATED_HUES,
  frontOf,
  GLOWING_HUES,
  MESH_REACH,
  reachOf,
  RESTING_TILT,
  restingOf,
  STANDING_IN,
  towardOf,
  type Placement,
} from "../src/features/catalog/artwork/arrangement.ts";

const ROOMS = [
  STANDING_IN.roughness,
  STANDING_IN.emission,
  STANDING_IN.coating,
] as const;

/** How much floor one subject covers, whichever way it is lying. */
const spread = (placement: Placement): number => MESH_REACH * placement.scale;

const between = (one: Placement, other: Placement): number =>
  Math.hypot(one.x - other.x, one.z - other.z);

describe("STANDING_IN", () => {
  it("stands somebody in every room", () => {
    for (const room of ROOMS) expect(room.length).toBeGreaterThan(0);
  });

  it("keeps every subject on the floor its own room lays", () => {
    for (const room of ROOMS) {
      for (const placement of room) {
        const corner = Math.hypot(placement.x, placement.z) + spread(placement);

        expect(corner).toBeLessThanOrEqual(reachOf(room));
      }
    }
  });

  it("never lets two subjects touch", () => {
    for (const room of ROOMS) {
      for (let one = 0; one < room.length; one += 1) {
        for (let other = one + 1; other < room.length; other += 1) {
          const first = room[one];
          const second = room[other];

          if (first === undefined || second === undefined) throw new Error("short");

          expect(between(first, second)).toBeGreaterThan(spread(first) + spread(second));
        }
      }
    }
  });

  it("keeps every subject smaller than the mesh's own size and larger than none", () => {
    for (const room of ROOMS) {
      for (const placement of room) {
        expect(placement.scale).toBeGreaterThan(0);
        expect(placement.scale).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stands the lone subject of a roughness room in the middle of the floor", () => {
    const [only] = STANDING_IN.roughness;

    if (only === undefined) throw new Error("short");

    expect(only.x).toBeCloseTo(0, 12);
    expect(only.z).toBeCloseTo(0, 12);
  });

  it("puts one coated subject in front of the eye and the other behind it", () => {
    const [near, far] = STANDING_IN.coating;

    if (near === undefined || far === undefined) throw new Error("short");

    expect(towardOf(near)).toBeGreaterThan(0);
    expect(towardOf(far)).toBeLessThan(0);
    // The near one is the bigger of the two as well as the closer, so what is
    // in front reads as in front rather than as merely large.
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("stands one coated subject well off the line the other is on", () => {
    // The far one is meant to be behind the near one, but two of them on one
    // line are one subject with a halo, so they are apart by more than half of
    // what the near one covers.
    const [near, far] = STANDING_IN.coating;

    if (near === undefined || far === undefined) throw new Error("short");

    const aside = (at: Placement): number => (at.x - at.z) * Math.SQRT1_2;

    expect(Math.abs(aside(near) - aside(far))).toBeGreaterThan(
      (MESH_REACH * near.scale) / 2,
    );
  });
});

describe("the hues each room is painted", () => {
  it("gives every subject in a room a hue of its own", () => {
    expect(GLOWING_HUES.length).toBeGreaterThanOrEqual(STANDING_IN.emission.length);
    expect(COATED_HUES.length).toBeGreaterThanOrEqual(STANDING_IN.coating.length);
  });

  it("paints every subject somewhere on the wheel", () => {
    for (const hue of [...GLOWING_HUES, ...COATED_HUES]) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("keeps the subjects of a room out of each other's part of the wheel", () => {
    // Three subjects in one family of the wheel read as a mistake rather than
    // as a choice, and two hues a shopper cannot tell apart demonstrate one.
    for (const hues of [GLOWING_HUES, COATED_HUES]) {
      for (let one = 0; one < hues.length; one += 1) {
        for (let other = one + 1; other < hues.length; other += 1) {
          const apart = Math.abs((hues[one] ?? 0) - (hues[other] ?? 0));

          expect(Math.min(apart, 360 - apart)).toBeGreaterThan(40);
        }
      }
    }
  });
});

describe("towardOf", () => {
  it("stands a subject on the eye's own line as far in front as it is out", () => {
    // Straight down the diagonal both walls are seen from, which is where the
    // whole of a placement is in front of the middle and none of it aside.
    expect(towardOf({ x: 2, z: 2, scale: 0.5, turn: 0 })).toBeCloseTo(2 * Math.SQRT2, 12);
  });

  it("stands a subject across that line in front of nothing", () => {
    expect(towardOf({ x: 1, z: -1, scale: 0.5, turn: 0 })).toBeCloseTo(0, 12);
  });

  it("answers negative for a subject behind the middle", () => {
    expect(towardOf({ x: -1, z: -1, scale: 0.5, turn: 0 })).toBeLessThan(0);
  });
});

describe("frontOf", () => {
  it("stands nobody in front of nothing", () => {
    expect(frontOf([])).toEqual({ toward: 0, reach: 0 });
  });

  it("answers for the subject furthest toward the eye", () => {
    const near: Placement = { x: 1, z: 1, scale: 0.5, turn: 0 };
    const far: Placement = { x: -1, z: -1, scale: 0.9, turn: 0 };

    expect(frontOf([far, near])).toEqual(frontOf([near, far]));
    expect(frontOf([far, near])).toEqual({
      toward: towardOf(near),
      reach: MESH_REACH * near.scale,
    });
  });

  it("answers for a lone subject wherever it stands", () => {
    const only: Placement = { x: -2, z: -2, scale: 0.3, turn: 0 };

    expect(frontOf([only])).toEqual({
      toward: towardOf(only),
      reach: MESH_REACH * only.scale,
    });
  });

  it("reaches around the near subject of the room it is asked about", () => {
    const front = frontOf(STANDING_IN.coating);

    expect(front.toward).toBeGreaterThan(0);
    expect(front.reach).toBeGreaterThan(0);
    expect(front.reach).toBeLessThanOrEqual(reachOf(STANDING_IN.coating));
  });
});

describe("reachOf", () => {
  it("reaches nowhere with nothing to reach around", () => {
    expect(reachOf([])).toBe(0);
  });

  it("covers a subject standing away from the middle, at its own size", () => {
    expect(reachOf([{ x: 3, z: 4, scale: 0.5, turn: 0 }])).toBeCloseTo(
      5 + MESH_REACH * 0.5,
      12,
    );
  });

  it("answers for the furthest subject in the room", () => {
    const near: Placement = { x: 0.5, z: 0, scale: 0.2, turn: 0 };
    const far: Placement = { x: 0, z: 2, scale: 0.2, turn: 0 };

    expect(reachOf([near, far])).toBe(reachOf([far]));
  });
});

describe("restingOf", () => {
  /** A shape with a point one above the middle, one below, and one in front. */
  const SHAPE = [0, 1, 0, 0, -1, 0, 0.5, 0, 1];

  it("leaves an untilted shape standing on its own lowest point", () => {
    const resting = restingOf(SHAPE, 0);

    expect(resting.drop).toBeCloseTo(1, 12);
    expect(resting.reach).toBeCloseTo(Math.hypot(0.5, 1), 12);
  });

  it("swaps a shape's height for its depth when it is laid flat", () => {
    const resting = restingOf(SHAPE, -Math.PI / 2);

    // What was above the middle is now behind it and what was below is now in
    // front, so nothing is left underneath and the depth it reaches is the
    // height it had.
    expect(resting.drop).toBeCloseTo(0, 12);
    expect(resting.reach).toBeCloseTo(1, 12);
  });

  it("never sinks a shape into the floor", () => {
    // Nothing below its own middle, so there is nothing to lift it off.
    expect(restingOf([0, 1, 0, 0, 2, 0], 0).drop).toBe(0);
  });

  it("ignores a trailing point it was handed only part of", () => {
    expect(restingOf([0, 1, 0, 0, -1], 0)).toEqual(restingOf([0, 1, 0], 0));
  });

  it("lays a shape onto its back without turning it over", () => {
    // The point in front of the middle comes up off the floor and the point
    // behind it goes down onto it, which is what lying back means. The point
    // above the middle stays above it, which is what stops a shape from going
    // over onto its own face.
    expect(restingOf([0, 0, 1], RESTING_TILT).drop).toBe(0);
    expect(restingOf([0, 0, -1], RESTING_TILT).drop).toBeGreaterThan(0);
    expect(restingOf([0, 1, 0], RESTING_TILT).drop).toBe(0);
  });
});
