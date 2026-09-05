/**
 * The pointer, as an angle.
 *
 * Two things are worth pinning: which way the slab turns, because a slab that
 * leans away from the finger instead of into it feels wrong in a way that is
 * hard to name; and that the walk toward that angle is a function of elapsed
 * time rather than of frames, because the alternative is an animation whose
 * speed depends on the machine.
 */

import { describe, expect, it } from "vitest";
import {
  approach,
  REST,
  settled,
  tiltAt,
  type Tilt,
} from "../src/features/catalog/artwork/tilt.ts";

const STAGE = { width: 200, height: 200 };

const at = (x: number, y: number): Tilt => tiltAt({ x, y }, STAGE);

/** Thirteen degrees, which is as far as the slab is allowed to go. */
const LIMIT = (13 * Math.PI) / 180;

describe("tiltAt", () => {
  it("leaves the slab square on when the pointer is dead center", () => {
    expect(at(100, 100)).toEqual(REST);
  });

  it("turns the edge under the pointer away from the viewer", () => {
    // Negative `rotation.x` takes the top edge back and positive `rotation.y`
    // takes the right edge back, so pressing a corner should send it back.
    expect(at(100, 0).x).toBeLessThan(0);
    expect(at(100, 200).x).toBeGreaterThan(0);
    expect(at(200, 100).y).toBeGreaterThan(0);
    expect(at(0, 100).y).toBeLessThan(0);
  });

  it("turns by the same amount in both directions", () => {
    expect(at(0, 0).x).toBe(-at(200, 200).x);
    expect(at(0, 0).y).toBe(-at(200, 200).y);
  });

  it("never turns further than the limit, in any direction", () => {
    for (const corner of [at(0, 0), at(200, 0), at(0, 200), at(200, 200)]) {
      expect(Math.abs(corner.x)).toBeCloseTo(LIMIT);
      expect(Math.abs(corner.y)).toBeCloseTo(LIMIT);
    }
  });

  it("stops turning once the pointer leaves the stage", () => {
    // Pointer capture can report a position outside the box; the slab is
    // already as far over as it goes.
    expect(at(-400, -400)).toEqual(at(0, 0));
    expect(at(900, 900)).toEqual(at(200, 200));
  });

  it("has nowhere to turn on a stage with no size", () => {
    expect(tiltAt({ x: 0, y: 0 }, { width: 0, height: 0 })).toEqual(REST);
  });

  it("reports a slab at rest as turned by nothing, not by minus nothing", () => {
    // `-0` survives arithmetic and formatting, and reads as a direction.
    expect(Object.is(at(100, 100).x, 0)).toBe(true);
    expect(Object.is(at(100, 100).y, 0)).toBe(true);
  });
});

describe("approach", () => {
  const TARGET: Tilt = { x: 0.2, y: -0.1 };

  it("moves toward the target and never past it", () => {
    const next = approach(REST, TARGET, 1 / 60);

    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(TARGET.x);
    expect(next.y).toBeLessThan(0);
    expect(next.y).toBeGreaterThan(TARGET.y);
  });

  it("stays where it is once it is there", () => {
    expect(approach(TARGET, TARGET, 1 / 60)).toEqual(TARGET);
  });

  it("covers no ground in no time", () => {
    expect(approach(REST, TARGET, 0)).toEqual(REST);
  });

  it("covers more ground in a longer frame", () => {
    const short = approach(REST, TARGET, 1 / 120);
    const long = approach(REST, TARGET, 1 / 30);

    expect(long.x).toBeGreaterThan(short.x);
  });

  it("gets to the same place however the frames fall", () => {
    // Which is the whole reason it is exponential rather than a step per
    // frame: a machine dropping half its frames must not animate at half
    // speed, it must animate in longer strides.
    const once = approach(REST, TARGET, 0.1);
    const twice = approach(approach(REST, TARGET, 0.05), TARGET, 0.05);

    expect(twice.x).toBeCloseTo(once.x, 12);
    expect(twice.y).toBeCloseTo(once.y, 12);
  });

  it("treats a frame that ran backwards as no time at all", () => {
    // A clock that steps back would otherwise send the slab away from its
    // target, which is the one direction it must never travel.
    expect(approach(REST, TARGET, -1)).toEqual(REST);
  });
});

describe("settled", () => {
  it("calls a slab exactly on its target arrived", () => {
    expect(settled(REST, REST)).toBe(true);
  });

  it("does not call a slab still visibly moving arrived", () => {
    expect(settled(REST, { x: 0.2, y: 0 })).toBe(false);
  });

  it("arrives, given enough frames", () => {
    const target: Tilt = { x: 0.2, y: -0.1 };
    let standing: Tilt = REST;

    for (let frame = 0; frame < 60; frame += 1) {
      standing = approach(standing, target, 1 / 60);
    }

    expect(settled(standing, target)).toBe(true);
  });
});
