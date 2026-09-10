import { describe, expect, it } from "vitest";
import { AT_REST, eyeFrom, viewpointOf } from "../src/features/catalog/artwork/viewpoint.ts";

const TARGET = { x: 0, y: 0.4, z: 0 };
const REST = { x: 1.2, y: 1.1, z: 2.5 };

const distance = (from: typeof REST, to: typeof REST): number =>
  Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);

describe("eyeFrom", () => {
  it("leaves the eye where it rests at rest", () => {
    const eye = eyeFrom(REST, TARGET, AT_REST);

    expect(eye.x).toBeCloseTo(REST.x, 12);
    expect(eye.y).toBeCloseTo(REST.y, 12);
    expect(eye.z).toBeCloseTo(REST.z, 12);
  });

  it("keeps the eye as far from what it looks at as it rests", () => {
    for (const viewpoint of [
      { around: 0.5, up: 0 },
      { around: -0.5, up: 0 },
      { around: 0, up: 0.3 },
      { around: 1.1, up: 0.2 },
    ]) {
      expect(distance(eyeFrom(REST, TARGET, viewpoint), TARGET)).toBeCloseTo(
        distance(REST, TARGET),
        12,
      );
    }
  });

  it("walks the eye to its own right for a positive turn", () => {
    // Standing on +z and looking back at the origin, the eye's right is +x.
    const straight = { x: 0, y: 0, z: 4 };
    const origin = { x: 0, y: 0, z: 0 };

    expect(eyeFrom(straight, origin, { around: 0.3, up: 0 }).x).toBeGreaterThan(0);
    expect(eyeFrom(straight, origin, { around: -0.3, up: 0 }).x).toBeLessThan(0);
  });

  it("raises the eye without moving it around", () => {
    const raised = eyeFrom(REST, TARGET, { around: 0, up: 0.3 });

    expect(raised.y).toBeGreaterThan(REST.y);
    expect(Math.atan2(raised.x, raised.z)).toBeCloseTo(Math.atan2(REST.x, REST.z), 12);
  });
});

describe("viewpointOf", () => {
  it("reads an angle's degrees as radians", () => {
    expect(
      viewpointOf({ name: "left", aroundDegrees: -90, upDegrees: 45, seenFrom: "" }),
    ).toEqual({ around: -Math.PI / 2, up: Math.PI / 4 });
  });
});
