import { describe, expect, it } from "vitest";
import {
  gramsToOunces,
  gramsToPounds,
  measure,
  millimetresToInches,
  roundTo,
  toImperial,
  type MetricMeasurements,
} from "./units.ts";

/** A 50 ml vial of colour, which is what every product in this shop ships in. */
const vial: MetricMeasurements = {
  weightGrams: 120,
  lengthMillimetres: 30,
  widthMillimetres: 30,
  heightMillimetres: 90,
};

describe("roundTo", () => {
  it("rounds to the requested precision", () => {
    expect(roundTo(2, 1.005)).toBe(1.01);
    expect(roundTo(2, 1.004)).toBe(1);
    expect(roundTo(0, 2.5)).toBe(3);
  });

  it("survives the classic float representation traps", () => {
    expect(roundTo(2, 0.1 + 0.2)).toBe(0.3);
    expect(roundTo(10, 0.1 + 0.2)).toBe(0.3);
  });

  it("rounds a decimal midpoint up even when its float sits just below", () => {
    // 1.005 is really 1.00499999999999989…, which naive rounding sends to 1.
    // The epsilon nudge is what makes the displayed price match the arithmetic.
    expect(1.005).toBe(1.0049999999999999);
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(roundTo(2, 1.005)).toBe(1.01);
  });

  it("does not drag genuinely-below-midpoint values up", () => {
    expect(roundTo(2, 1.0049)).toBe(1);
    expect(roundTo(2, 1.004)).toBe(1);
    expect(roundTo(2, 1.0)).toBe(1);
  });

  it("leaves already-short values alone", () => {
    expect(roundTo(2, 42)).toBe(42);
    expect(roundTo(3, 0)).toBe(0);
  });
});

describe("mass conversion", () => {
  it("converts grams to ounces against the international avoirdupois ounce", () => {
    expect(gramsToOunces(28.349523125)).toBe(1);
    expect(gramsToOunces(120)).toBe(4.23);
    expect(gramsToOunces(0)).toBe(0);
  });

  it("converts grams to pounds", () => {
    expect(gramsToPounds(453.59237)).toBe(1);
    expect(gramsToPounds(120)).toBe(0.265);
  });

  it("keeps pounds and ounces consistent with each other", () => {
    expect(roundTo(1, gramsToPounds(1000) * 16)).toBe(roundTo(1, gramsToOunces(1000)));
  });
});

describe("length conversion", () => {
  it("converts millimetres to inches against the international inch", () => {
    expect(millimetresToInches(25.4)).toBe(1);
    expect(millimetresToInches(30)).toBe(1.18);
    expect(millimetresToInches(90)).toBe(3.54);
  });

  it("maps zero to zero", () => {
    expect(millimetresToInches(0)).toBe(0);
  });
});

describe("toImperial", () => {
  it("derives every imperial field from the metric source", () => {
    expect(toImperial(vial)).toEqual({
      weightOunces: 4.23,
      weightPounds: 0.265,
      lengthInches: 1.18,
      widthInches: 1.18,
      heightInches: 3.54,
    });
  });

  it("is pure — the same input always gives an equal result", () => {
    expect(toImperial(vial)).toEqual(toImperial(vial));
  });

  it("does not mutate its input", () => {
    const snapshot = { ...vial };
    toImperial(vial);
    expect(vial).toEqual(snapshot);
  });
});

describe("measure", () => {
  it("carries the stored metric values through untouched", () => {
    expect(measure(vial).metric).toEqual(vial);
  });

  it("pairs them with the derived imperial values", () => {
    expect(measure(vial).imperial).toEqual(toImperial(vial));
  });
});
