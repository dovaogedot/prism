/**
 * The same picture every time.
 *
 * What is worth pinning is that the sequence drawn from a seed is the one
 * written down here, because "deterministic" is a claim about every machine
 * and every release, not about two calls in one process.
 */

import { describe, expect, it } from "vitest";
import { randomFrom } from "../src/features/catalog/artwork/seeded.ts";

const draw = (seed: number, count: number): readonly number[] => {
  const random = randomFrom(seed);

  return Array.from({ length: count }, () => random());
};

describe("randomFrom", () => {
  it("draws the sequence it has always drawn", () => {
    expect(draw(1, 5)).toEqual([
      0.6270739405881613, 0.0027357211802154779, 0.5274470399599522,
      0.9810509674716741, 0.9683778982143849,
    ]);
  });

  it("gives two generators on one seed the same sequence", () => {
    expect(draw(0xa137f2c9, 8)).toEqual(draw(0xa137f2c9, 8));
  });

  it("gives two seeds different sequences", () => {
    expect(draw(1, 8)).not.toEqual(draw(2, 8));
  });

  it("keeps every value at or above zero and below one", () => {
    for (const value of draw(0xa137f2c9, 2000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("hands each generator its own state", () => {
    const first = randomFrom(7);
    const second = randomFrom(7);

    first();

    expect(second()).toBe(draw(7, 1)[0]);
  });
});
