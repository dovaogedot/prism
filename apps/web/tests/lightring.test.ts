/**
 * The lamps that circle a roughness room.
 *
 * Two claims to pin. That the formation is a formation — as many lamps as
 * there are lags, evenly spaced, all of them above the floor at every angle
 * the pointer can reach. And that they come apart and back together the way
 * the room is built to show: each lamp covers its own share of the distance
 * per frame, the quick ones more than the slow ones, and all of them arrive.
 */

import { describe, expect, it } from "vitest";
import { orbitAt, REST_ORBIT, type Eye } from "../src/features/catalog/artwork/orbit.ts";
import {
  formed,
  lagged,
  LAGS,
  restingAt,
  ringAt,
} from "../src/features/catalog/artwork/lightring.ts";

const STAGE = { width: 200, height: 200 };
const RADIUS = 4;

const away = (one: Eye, other: Eye): number =>
  Math.hypot(one.x - other.x, one.y - other.y, one.z - other.z);

const nth = <A,>(items: readonly A[], at: number): A => {
  const item = items[at];

  if (item === undefined) throw new Error(`nothing at ${at}`);

  return item;
};

describe("ringAt", () => {
  it("hangs exactly as many lamps as it was asked for", () => {
    for (const count of [1, 2, 4, 7]) {
      expect(ringAt(count, REST_ORBIT, RADIUS)).toHaveLength(count);
    }
  });

  it("spaces them evenly all the way round", () => {
    const ring = ringAt(4, orbitAt({ x: 170, y: 60 }, STAGE), RADIUS);
    const first = away(nth(ring, 0), nth(ring, 1));

    expect(away(nth(ring, 1), nth(ring, 2))).toBeCloseTo(first, 12);
    expect(away(nth(ring, 2), nth(ring, 3))).toBeCloseTo(first, 12);
    expect(away(nth(ring, 3), nth(ring, 0))).toBeCloseTo(first, 12);
  });

  it("hangs every lamp the same distance out", () => {
    for (const lamp of ringAt(4, orbitAt({ x: 20, y: 190 }, STAGE), RADIUS)) {
      expect(Math.hypot(lamp.x, lamp.y, lamp.z)).toBeCloseTo(RADIUS, 12);
    }
  });

  it("keeps every lamp above the floor, wherever the pointer is", () => {
    for (let x = -100; x <= 300; x += 20) {
      for (let y = -100; y <= 300; y += 20) {
        for (const lamp of ringAt(4, orbitAt({ x, y }, STAGE), RADIUS)) {
          expect(lamp.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("turns the whole ring with the pointer", () => {
    const still = ringAt(4, REST_ORBIT, RADIUS);
    const turned = ringAt(4, orbitAt({ x: 200, y: 100 }, STAGE), RADIUS);

    expect(away(nth(still, 0), nth(turned, 0))).toBeGreaterThan(0.5);
  });
});

describe("lagged", () => {
  const turned = orbitAt({ x: 200, y: 100 }, STAGE);

  it("keeps every lamp's own lag as it moves it", () => {
    const moved = lagged(restingAt(LAGS, REST_ORBIT, RADIUS), turned, RADIUS, 0.016);

    expect(moved.map(({ lag }) => lag)).toEqual([...LAGS]);
  });

  it("moves the quick lamps further along their own way than the slow ones", () => {
    const resting = restingAt(LAGS, REST_ORBIT, RADIUS);
    const targets = ringAt(resting.length, turned, RADIUS);
    const moved = lagged(resting, turned, RADIUS, 0.05);

    const covered = moved.map((lamp, at) => {
      const target = nth(targets, at);

      return 1 - away(lamp.at, target) / away(nth(resting, at).at, target);
    });

    for (let at = 1; at < covered.length; at += 1) {
      expect(nth(covered, at)).toBeLessThan(nth(covered, at - 1));
    }
  });

  it("throws the formation apart before it closes back up", () => {
    const resting = restingAt(LAGS, REST_ORBIT, RADIUS);
    const spacing = away(nth(resting, 0).at, nth(resting, 1).at);
    const moved = lagged(resting, turned, RADIUS, 0.05);

    expect(away(nth(moved, 0).at, nth(moved, 1).at)).not.toBeCloseTo(spacing, 3);
  });

  it("brings every lamp back into formation, and says so", () => {
    let lamps = restingAt(LAGS, REST_ORBIT, RADIUS);

    expect(formed(lamps, turned, RADIUS)).toBe(false);

    for (let frame = 0; frame < 600; frame += 1) {
      lamps = lagged(lamps, turned, RADIUS, 0.016);
    }

    expect(formed(lamps, turned, RADIUS)).toBe(true);
  });

  it("says a ring already on its slots is in formation", () => {
    expect(formed(restingAt(LAGS, turned, RADIUS), turned, RADIUS)).toBe(true);
  });

  it("covers the same ground in one long frame as in many short ones", () => {
    const whole = lagged(restingAt(LAGS, REST_ORBIT, RADIUS), turned, RADIUS, 0.2);

    let split = restingAt(LAGS, REST_ORBIT, RADIUS);
    for (let frame = 0; frame < 40; frame += 1) {
      split = lagged(split, turned, RADIUS, 0.005);
    }

    for (let at = 0; at < LAGS.length; at += 1) {
      expect(away(nth(split, at).at, nth(whole, at).at)).toBeLessThan(1e-9);
    }
  });
});
