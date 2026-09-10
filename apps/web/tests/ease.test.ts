/**
 * Movement that catches up.
 *
 * The one property worth pinning is that the walk is a function of elapsed
 * time rather than of frames: the alternative is an animation whose speed
 * depends on the machine it is running on, which is the kind of bug nobody
 * finds until a slow laptop opens the page.
 */

import { describe, expect, it } from "vitest";
import { arrived, SETTLE_SECONDS, toward } from "../src/features/catalog/artwork/ease.ts";

describe("toward", () => {
  it("covers the time constant's share of the distance in the time constant", () => {
    // 1 - 1/e, which is what makes the number a time constant at all.
    expect(toward(0, 1, SETTLE_SECONDS, SETTLE_SECONDS)).toBeCloseTo(1 - 1 / Math.E, 12);
  });

  it("moves toward the target and never past it", () => {
    expect(toward(0, 10, 0.02, SETTLE_SECONDS)).toBeGreaterThan(0);
    expect(toward(0, 10, 0.02, SETTLE_SECONDS)).toBeLessThan(10);
    expect(toward(10, 0, 0.02, SETTLE_SECONDS)).toBeLessThan(10);
    expect(toward(10, 0, 0.02, SETTLE_SECONDS)).toBeGreaterThan(0);
  });

  it("arrives at once when there is no time constant to wait out", () => {
    expect(toward(0, 7, 0.001, 0)).toBe(7);
    expect(toward(0, 7, 0.001, -1)).toBe(7);
  });

  it("stays put across no time at all", () => {
    expect(toward(3, 9, 0, SETTLE_SECONDS)).toBe(3);
  });

  it("treats time before the frame started as no time", () => {
    expect(toward(3, 9, -5, SETTLE_SECONDS)).toBe(3);
  });

  it("covers the same ground in one long frame as in many short ones", () => {
    const whole = toward(0, 1, 0.25, SETTLE_SECONDS);

    let split = 0;
    for (let frame = 0; frame < 50; frame += 1) {
      split = toward(split, 1, 0.005, SETTLE_SECONDS);
    }

    expect(split).toBeCloseTo(whole, 12);
  });

  it("gets arbitrarily close to the target and never reaches it", () => {
    let value = 0;
    for (let frame = 0; frame < 1000; frame += 1) {
      value = toward(value, 1, 0.016, SETTLE_SECONDS);
    }

    expect(value).toBeLessThan(1);
    expect(value).toBeGreaterThan(0.999999);
  });
});

describe("arrived", () => {
  it("is true only once the distance is under the threshold", () => {
    expect(arrived(1, 1.0005, 0.001)).toBe(true);
    expect(arrived(1, 1.002, 0.001)).toBe(false);
  });

  it("does not care which side of the target the value is on", () => {
    expect(arrived(1.0005, 1, 0.001)).toBe(true);
    expect(arrived(0.9995, 1, 0.001)).toBe(true);
  });

  it("is true of a value sitting exactly on its target", () => {
    expect(arrived(2, 2, 0.001)).toBe(true);
  });
});
