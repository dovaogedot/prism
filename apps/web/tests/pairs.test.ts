/**
 * Joining a room's fixed subjects to the arrangement it is handed.
 *
 * The property worth having is totality: whatever the two lengths, every pair
 * that comes back holds two real values, so no caller has to guard against a
 * half-absent one.
 */

import { describe, expect, it } from "vitest";
import { pairedWith } from "../src/features/catalog/artwork/pairs.ts";

describe("pairedWith", () => {
  it("pairs off equal lists in order", () => {
    expect(pairedWith([1, 2, 3], ["a", "b", "c"])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });

  it("stops where the shorter list stops, whichever it is", () => {
    expect(pairedWith([1, 2, 3], ["a"])).toEqual([[1, "a"]]);
    expect(pairedWith([1], ["a", "b", "c"])).toEqual([[1, "a"]]);
  });

  it("pairs nothing with an empty list", () => {
    expect(pairedWith([], ["a", "b"])).toEqual([]);
    expect(pairedWith([1, 2], [])).toEqual([]);
  });

  it("never hands back a pair with a hole in it", () => {
    const sparse = [1, 2, 3];
    const shorter = ["a", "b"];

    for (const pair of pairedWith(sparse, shorter)) {
      expect(pair).toHaveLength(2);
      expect(pair[0]).toBeTypeOf("number");
      expect(pair[1]).toBeTypeOf("string");
    }
  });

  it("keeps both lists as they were", () => {
    const left = [1, 2];
    const right = ["a", "b"];

    pairedWith(left, right);

    expect(left).toEqual([1, 2]);
    expect(right).toEqual(["a", "b"]);
  });
});
