import { describe, expect, it } from "vitest";
import {
  gramsToOunces,
  kelvinToCelsius,
  kelvinToFahrenheit,
  measure,
  metersToFeet,
  roundTo,
  toImperial,
  type MetricMeasurements,
} from "../../src/index.ts";

/** Ceremonial Gold: hue 42°, saturation 87%, lightness 64%. */
const gold: MetricMeasurements = {
  temperatureKelvin: 2596,
  reachMeters: 293.5,
  weightGrams: 99,
};

describe("roundTo", () => {
  it("rounds to the requested number of places", () => {
    expect(roundTo(2, 1.234)).toBe(1.23);
    expect(roundTo(2, 1.235)).toBe(1.24);
    expect(roundTo(0, 2.5)).toBe(3);
  });

  it("returns whole numbers unchanged", () => {
    expect(roundTo(2, 42)).toBe(42);
  });

  it("keeps the sign", () => {
    expect(roundTo(1, -273.15)).toBe(-273.2);
  });
});

describe("gramsToOunces", () => {
  it("converts at the international avoirdupois ounce", () => {
    expect(gramsToOunces(28.349523125)).toBe(1);
    expect(gramsToOunces(100)).toBe(3.53);
  });

  it("maps zero to zero", () => {
    expect(gramsToOunces(0)).toBe(0);
  });
});

describe("metersToFeet", () => {
  it("converts at the international foot", () => {
    expect(metersToFeet(0.3048)).toBe(1);
    expect(metersToFeet(100)).toBe(328.1);
  });

  it("maps zero to zero", () => {
    expect(metersToFeet(0)).toBe(0);
  });
});

describe("kelvinToCelsius", () => {
  it("puts absolute zero at -273.15", () => {
    expect(kelvinToCelsius(0)).toBe(-273.2);
  });

  it("puts the freezing point of water at zero", () => {
    expect(kelvinToCelsius(273.15)).toBe(0);
  });
});

describe("kelvinToFahrenheit", () => {
  it("puts the freezing point of water at 32", () => {
    expect(kelvinToFahrenheit(273.15)).toBe(32);
  });

  it("puts the boiling point of water at 212", () => {
    expect(kelvinToFahrenheit(373.15)).toBe(212);
  });

  it("converts from the raw kelvin rather than the rounded Celsius", () => {
    // Going through the displayed Celsius value rounds twice and lands a tenth
    // of a degree out. Both numbers appear on the product page, so the two
    // conversions have to start from the same unrounded source.
    const kelvin = 2596;
    const viaRoundedCelsius = roundTo(1, kelvinToCelsius(kelvin) * (9 / 5) + 32);

    expect(kelvinToFahrenheit(kelvin)).toBe(4213.1);
    expect(viaRoundedCelsius).toBe(4213.2);
  });
});

describe("toImperial", () => {
  it("converts every measurement", () => {
    expect(toImperial(gold)).toEqual({
      temperatureFahrenheit: 4213.1,
      reachFeet: 962.9,
      weightOunces: 3.49,
    });
  });

  it("is pure", () => {
    expect(toImperial(gold)).toEqual(toImperial(gold));
  });

  it("does not touch its input", () => {
    const snapshot = { ...gold };
    toImperial(gold);
    expect(gold).toEqual(snapshot);
  });
});

describe("measure", () => {
  it("carries the metric values through untouched", () => {
    expect(measure(gold).metric).toMatchObject(gold);
  });

  it("adds Celsius, which is Kelvin with one subtraction", () => {
    expect(measure(gold).metric.temperatureCelsius).toBe(kelvinToCelsius(2596));
  });

  it("derives the imperial half rather than storing it", () => {
    expect(measure(gold).imperial).toEqual(toImperial(gold));
  });
});
