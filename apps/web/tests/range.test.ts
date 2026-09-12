import { describe, expect, it } from "vitest";
import { Range } from "../src/features/catalog/components/RangeSlider.tsx";

describe("Range.clamp", () => {
  it("keeps a value inside the bounds", () => {
    expect(Range.clamp(5, 0, 10)).toBe(5);
    expect(Range.clamp(-1, 0, 10)).toBe(0);
    expect(Range.clamp(11, 0, 10)).toBe(10);
  });
});
