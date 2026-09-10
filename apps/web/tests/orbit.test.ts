/**
 * Where the eye stands.
 *
 * What matters is the frame of reference and one hard limit. The frame:
 * pushing the pointer up has to raise the eye, and the stage has to be worth
 * crossing — an eye that swings ten degrees is an eye that has not moved. The
 * limit: the eye never drops through the floor, whatever the pointer does,
 * because a room seen from underneath is not a room.
 */

import { describe, expect, it } from "vitest";
import {
  approachOrbit,
  eyeAt,
  orbitAt,
  orbitSettled,
  REST_ORBIT,
} from "../src/features/catalog/artwork/orbit.ts";

const STAGE = { width: 200, height: 200 };

const at = (x: number, y: number): ReturnType<typeof orbitAt> =>
  orbitAt({ x, y }, STAGE);

describe("orbitAt", () => {
  it("leaves the eye at rest with the pointer dead center", () => {
    expect(at(100, 100)).toEqual(REST_ORBIT);
  });

  it("carries the eye round the way the pointer went", () => {
    expect(at(200, 100).azimuth).toBeGreaterThan(0);
    expect(at(0, 100).azimuth).toBeLessThan(0);
  });

  it("swings the same distance either side", () => {
    expect(at(0, 100).azimuth).toBe(-at(200, 100).azimuth);
  });

  it("crosses enough of the room to be worth crossing", () => {
    // A quarter turn from edge to edge, so the two sides of the stage show
    // visibly different sides of the room.
    expect(at(200, 100).azimuth - at(0, 100).azimuth).toBeGreaterThan(Math.PI / 2);
  });

  it("raises the eye as the pointer goes up", () => {
    expect(at(100, 0).elevation).toBeGreaterThan(REST_ORBIT.elevation);
    expect(at(100, 200).elevation).toBeLessThan(REST_ORBIT.elevation);
  });

  it("keeps the eye above the floor everywhere on the stage, and off it", () => {
    for (let x = -200; x <= 400; x += 20) {
      for (let y = -200; y <= 400; y += 20) {
        expect(at(x, y).elevation).toBeGreaterThan(0);
      }
    }
  });

  it("has nowhere to go on a stage with no size", () => {
    expect(orbitAt({ x: 5, y: 5 }, { width: 0, height: 0 })).toEqual(REST_ORBIT);
  });
});

describe("eyeAt", () => {
  it("stands exactly as far back as it was told to", () => {
    for (let x = 0; x <= 200; x += 25) {
      for (let y = 0; y <= 200; y += 25) {
        const eye = eyeAt(at(x, y), 7.5);

        expect(Math.hypot(eye.x, eye.y, eye.z)).toBeCloseTo(7.5, 12);
      }
    }
  });

  it("puts the eye in front of the room and above it at rest", () => {
    const eye = eyeAt(REST_ORBIT, 5);

    expect(eye.x).toBeCloseTo(0, 12);
    expect(eye.y).toBeGreaterThan(0);
    expect(eye.z).toBeGreaterThan(0);
  });

  it("stays above the floor wherever the pointer sends it", () => {
    for (let x = -100; x <= 300; x += 20) {
      expect(eyeAt(at(x, 200), 5).y).toBeGreaterThan(0);
    }
  });

  it("takes the eye round to the side the azimuth names", () => {
    expect(eyeAt(at(200, 100), 5).x).toBeGreaterThan(0);
    expect(eyeAt(at(0, 100), 5).x).toBeLessThan(0);
  });
});

describe("approachOrbit", () => {
  it("walks toward the target without arriving at it", () => {
    const target = at(200, 0);
    const moved = approachOrbit(REST_ORBIT, target, 0.02);

    expect(moved.azimuth).toBeGreaterThan(REST_ORBIT.azimuth);
    expect(moved.azimuth).toBeLessThan(target.azimuth);
    expect(orbitSettled(moved, target)).toBe(false);
  });

  it("settles, and stops the loop when it does", () => {
    const target = at(200, 0);
    let current = REST_ORBIT;

    for (let frame = 0; frame < 200; frame += 1) {
      current = approachOrbit(current, target, 0.016);
    }

    expect(orbitSettled(current, target)).toBe(true);
  });

  it("covers the same ground in one long frame as in many short ones", () => {
    const target = at(200, 0);
    const whole = approachOrbit(REST_ORBIT, target, 0.2);

    let split = REST_ORBIT;
    for (let frame = 0; frame < 40; frame += 1) {
      split = approachOrbit(split, target, 0.005);
    }

    expect(split.azimuth).toBeCloseTo(whole.azimuth, 12);
    expect(split.elevation).toBeCloseTo(whole.elevation, 12);
  });
});
