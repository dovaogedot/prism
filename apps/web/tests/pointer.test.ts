/**
 * The pointer, as a pair of fractions.
 *
 * Everything a stage does with the pointer starts here, so what is pinned is
 * the frame of reference: which way the numbers grow, that the middle really
 * is zero, and that a finger dragged outside the box does not keep going.
 */

import { describe, expect, it } from "vitest";
import {
  MIDDLE,
  offsetIn,
  pointAt,
  withinStage,
} from "../src/features/catalog/artwork/pointer.ts";

const STAGE = { width: 200, height: 100 };

const at = (x: number, y: number): ReturnType<typeof offsetIn> =>
  offsetIn({ x, y }, STAGE);

describe("offsetIn", () => {
  it("reads dead center as no offset at all", () => {
    expect(at(100, 50)).toEqual(MIDDLE);
  });

  it("grows to the right and toward the bottom", () => {
    expect(at(200, 50)).toEqual({ across: 1, down: 0 });
    expect(at(0, 50)).toEqual({ across: -1, down: 0 });
    expect(at(100, 100)).toEqual({ across: 0, down: 1 });
    expect(at(100, 0)).toEqual({ across: 0, down: -1 });
  });

  it("measures each axis against its own edge", () => {
    // Half way to the right edge and half way to the bottom, on a stage twice
    // as wide as it is tall, has to read the same on both axes.
    expect(at(150, 75)).toEqual({ across: 0.5, down: 0.5 });
  });

  it("stops at the edge once the pointer leaves the stage", () => {
    // Pointer capture goes on reporting positions after the finger has left.
    expect(at(-900, -900)).toEqual(at(0, 0));
    expect(at(900, 900)).toEqual(at(200, 100));
  });

  it("has nowhere to measure from on a stage with no size", () => {
    expect(offsetIn({ x: 5, y: 5 }, { width: 0, height: 100 })).toEqual(MIDDLE);
    expect(offsetIn({ x: 5, y: 5 }, { width: 200, height: 0 })).toEqual(MIDDLE);
  });

  it("never reports the negative zero", () => {
    expect(Object.is(at(100, 50).across, 0)).toBe(true);
    expect(Object.is(at(100, 50).down, 0)).toBe(true);
  });
});

describe("withinStage", () => {
  it("leaves an offset inside the stage as it is", () => {
    expect(withinStage({ across: 0.25, down: -0.75 })).toEqual({ across: 0.25, down: -0.75 });
  });

  it("stops each axis at the edge", () => {
    expect(withinStage({ across: 3, down: -3 })).toEqual({ across: 1, down: -1 });
  });

  it("never hands back the negative zero", () => {
    expect(Object.is(withinStage({ across: -0, down: -0 }).across, 0)).toBe(true);
    expect(Object.is(withinStage({ across: -0, down: -0 }).down, 0)).toBe(true);
  });
});

describe("pointAt", () => {
  it("puts the middle in the middle", () => {
    expect(pointAt(MIDDLE, STAGE)).toEqual({ x: 100, y: 50 });
  });

  it("is the way back from offsetIn", () => {
    for (const offset of [
      { across: -1, down: -1 },
      { across: 0.5, down: -0.25 },
      { across: 1, down: 1 },
    ]) {
      const back = offsetIn(pointAt(offset, STAGE), STAGE);

      expect(back.across).toBeCloseTo(offset.across, 10);
      expect(back.down).toBeCloseTo(offset.down, 10);
    }
  });
});
