/**
 * The phone's tilt, as a place on the stage.
 *
 * What is pinned is the frame of reference, because a tilt that turns the
 * picture the wrong way feels broken without anyone being able to say why:
 * which edge a tilt points at, that the page being turned turns the reading
 * with it, that holding the phone at any angle reads as the middle, and that
 * letting the hold catch up is a function of time rather than of how often
 * the phone reports.
 */

import { describe, expect, it } from "vitest";
import {
  fallOf,
  heldAfter,
  HOLD_SECONDS,
  LEAN_STEP,
  leanOf,
  movedFrom,
  type Fall,
} from "../src/features/catalog/artwork/lean.ts";
import { MIDDLE } from "../src/features/catalog/artwork/pointer.ts";

/** A phone held up to be read, and the way down falls across it. */
const HELD: Fall = fallOf({ beta: 45, gamma: 0 });

const leaned = (beta: number, gamma: number, screenDegrees = 0) =>
  leanOf(fallOf({ beta, gamma }), HELD, screenDegrees);

describe("fallOf", () => {
  it("has nothing falling across a phone lying flat", () => {
    const flat = fallOf({ beta: 0, gamma: 0 });

    expect(flat.x).toBeCloseTo(0);
    expect(flat.y).toBeCloseTo(0);
  });

  it("falls toward the bottom edge of a phone standing upright", () => {
    const upright = fallOf({ beta: 90, gamma: 0 });

    expect(upright.x).toBeCloseTo(0);
    expect(upright.y).toBeCloseTo(-1);
  });

  it("falls toward the right edge as the right edge dips", () => {
    expect(fallOf({ beta: 0, gamma: 20 }).x).toBeGreaterThan(0);
    expect(fallOf({ beta: 0, gamma: -20 }).x).toBeLessThan(0);
  });

  it("stays put through upright, where the side to side angle stops meaning anything", () => {
    for (const gamma of [-80, -30, 0, 30, 80]) {
      const upright = fallOf({ beta: 90, gamma });

      expect(upright.x).toBeCloseTo(0);
      expect(upright.y).toBeCloseTo(-1);
    }
  });
});

describe("leanOf", () => {
  it("reads the phone held the way it is held as the middle", () => {
    expect(leanOf(HELD, HELD, 0)).toEqual(MIDDLE);
    expect(leanOf(HELD, HELD, 90)).toEqual(MIDDLE);
  });

  it("points at the edge that comes up toward the viewer", () => {
    // The right edge coming up is the left one dipping.
    expect(leaned(45, -10).across).toBeGreaterThan(0);
    expect(leaned(45, 10).across).toBeLessThan(0);
    // The top edge tipping back toward flat brings the bottom edge up.
    expect(leaned(35, 0).down).toBeGreaterThan(0);
    expect(leaned(55, 0).down).toBeLessThan(0);
  });

  it("reads a tilt to one side as nothing up or down, and the other way round", () => {
    expect(leaned(45, -10).down).toBeCloseTo(0);
    expect(leaned(35, 0).across).toBeCloseTo(0);
  });

  it("goes no further than the edge of the stage", () => {
    expect(leaned(45, -80).across).toBe(1);
    expect(leaned(45, 80).across).toBe(-1);
    expect(leaned(0, 0).down).toBe(1);
  });

  it("reads a tilt along the page's own width and height when the page is turned", () => {
    const upright = leaned(38, -7);
    const quarter = leaned(38, -7, 90);
    const half = leaned(38, -7, 180);

    expect(quarter.across).toBeCloseTo(upright.down);
    expect(quarter.down).toBeCloseTo(-upright.across);
    expect(half.across).toBeCloseTo(-upright.across);
    expect(half.down).toBeCloseTo(-upright.down);
  });
});

describe("heldAfter", () => {
  const tilted = fallOf({ beta: 30, gamma: 15 });

  it("stays where it was when no time has passed", () => {
    expect(heldAfter(HELD, tilted, 0)).toEqual(HELD);
  });

  it("comes to be the way the phone is held, given long enough", () => {
    const caught = heldAfter(HELD, tilted, HOLD_SECONDS * 10);

    expect(caught.x).toBeCloseTo(tilted.x, 3);
    expect(caught.y).toBeCloseTo(tilted.y, 3);
  });

  it("gets as far on two readings as on one that took as long as both", () => {
    const once = heldAfter(HELD, tilted, 0.2);
    const twice = heldAfter(heldAfter(HELD, tilted, 0.1), tilted, 0.1);

    expect(twice.x).toBeCloseTo(once.x, 10);
    expect(twice.y).toBeCloseTo(once.y, 10);
  });

  it("lets a tilt go: the lean falls back toward the middle as the phone is held still", () => {
    const early = leanOf(tilted, heldAfter(HELD, tilted, 0.1), 0);
    const late = leanOf(tilted, heldAfter(HELD, tilted, HOLD_SECONDS * 3), 0);

    expect(Math.abs(late.across)).toBeLessThan(Math.abs(early.across));
    expect(Math.abs(late.down)).toBeLessThan(Math.abs(early.down));
  });
});

describe("movedFrom", () => {
  it("passes on nothing smaller than a step", () => {
    expect(movedFrom(MIDDLE, { across: LEAN_STEP / 2, down: -LEAN_STEP / 2 })).toBe(false);
  });

  it("passes on a step on either axis", () => {
    expect(movedFrom(MIDDLE, { across: LEAN_STEP, down: 0 })).toBe(true);
    expect(movedFrom(MIDDLE, { across: 0, down: -LEAN_STEP })).toBe(true);
  });
});
