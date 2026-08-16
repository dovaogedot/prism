import { describe, expect, it } from "vitest";
import {
  gramsToOunces,
  kelvinToCelsius,
  kelvinToFahrenheit,
  measureColor,
  measureFinisher,
  measureShifter,
  metersToFeet,
  micrometersToMils,
  millimetersToInches,
  newtonMetersToPoundFeet,
  roundTo,
  squareMetersToSquareFeet,
  type ColorMetric,
  type FinisherMetric,
  type ShifterMetric,
} from "../../src/index.ts";

/** Ceremonial Gold: hue 42°, saturation 87%, lightness 64%. */
const gold: ColorMetric = {
  temperatureKelvin: 2596,
  reachMeters: 293.5,
  weightGrams: 99,
};

/** A matte bath good for twelve colors. */
const bath: FinisherMetric = {
  coverageSquareMeters: 25.2,
  grainMicrometers: 34,
  weightGrams: 235,
};

/** A counter-clockwise swing of 120°. */
const swing: ShifterMetric = {
  torqueNewtonMeters: 5.4,
  backlashMillimeters: 0.64,
  weightGrams: 249,
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

describe("squareMetersToSquareFeet", () => {
  it("converts a square metre", () => {
    expect(squareMetersToSquareFeet(1)).toBe(10.8);
  });

  it("scales as an area rather than as a length", () => {
    // The trap: 3 m is 9.8 ft, but 3 m² is 32.3 ft², not 9.8.
    expect(squareMetersToSquareFeet(3)).toBe(32.3);
  });
});

describe("micrometersToMils", () => {
  it("puts a mil at 25.4 micrometres, being a thousandth of an inch", () => {
    expect(micrometersToMils(25.4)).toBe(1);
  });

  it("converts a coarse matte grain", () => {
    expect(micrometersToMils(34)).toBe(1.34);
  });
});

describe("newtonMetersToPoundFeet", () => {
  it("converts one pound-foot back to itself", () => {
    expect(newtonMetersToPoundFeet(1.3558179483314004)).toBe(1);
  });

  it("converts a mid-range shifter", () => {
    expect(newtonMetersToPoundFeet(5.4)).toBe(3.98);
  });
});

describe("millimetersToInches", () => {
  it("puts an inch at 25.4 millimetres", () => {
    expect(millimetersToInches(25.4)).toBe(1);
  });

  it("keeps enough places for a number that never leaves the sub-millimetre", () => {
    // Backlash is fractions of a millimetre, so two decimal places of inches
    // would round every shifter in the catalog to the same 0.03 in.
    expect(millimetersToInches(0.64)).toBe(0.025);
    expect(millimetersToInches(0.9)).toBe(0.035);
  });
});

describe("measureColor", () => {
  it("carries the metric values through, less the kelvin", () => {
    // Kelvin is what the column stores and what Celsius is derived from, but
    // it is not a number the shop shows anyone.
    expect(measureColor(gold).metric).toEqual({
      temperatureCelsius: kelvinToCelsius(2596),
      reachMeters: 293.5,
      weightGrams: 99,
    });
    expect(measureColor(gold).metric).not.toHaveProperty("temperatureKelvin");
  });

  it("derives the imperial half rather than storing it", () => {
    expect(measureColor(gold).imperial).toEqual({
      temperatureFahrenheit: kelvinToFahrenheit(2596),
      reachFeet: metersToFeet(293.5),
      weightOunces: gramsToOunces(99),
    });
  });

  it("is pure, and does not touch its input", () => {
    const snapshot = { ...gold };

    expect(measureColor(gold)).toEqual(measureColor(gold));
    expect(gold).toEqual(snapshot);
  });
});

describe("measureFinisher", () => {
  it("measures a tin by what a tin has", () => {
    // No temperature and no reach: a tin of finisher has neither.
    expect(measureFinisher(bath)).toEqual({
      of: "finisher",
      metric: bath,
      imperial: {
        coverageSquareFeet: squareMetersToSquareFeet(25.2),
        grainMils: micrometersToMils(34),
        weightOunces: gramsToOunces(235),
      },
    });
  });

  it("shares only weight with a color", () => {
    const finisher = Object.keys(measureFinisher(bath).metric);
    const color = Object.keys(measureColor(gold).metric);

    expect(finisher.filter((key) => color.includes(key))).toEqual(["weightGrams"]);
  });
});

describe("measureShifter", () => {
  it("measures a mechanism by what a mechanism has", () => {
    expect(measureShifter(swing)).toEqual({
      of: "shifter",
      metric: swing,
      imperial: {
        torquePoundFeet: newtonMetersToPoundFeet(5.4),
        backlashInches: millimetersToInches(0.64),
        weightOunces: gramsToOunces(249),
      },
    });
  });

  it("shares only weight with a finisher", () => {
    const shifter = Object.keys(measureShifter(swing).metric);
    const finisher = Object.keys(measureFinisher(bath).metric);

    expect(shifter.filter((key) => finisher.includes(key))).toEqual(["weightGrams"]);
  });
});

describe("every kind tags its measurements", () => {
  it("so a block and the product carrying it can be matched separately", () => {
    expect(measureColor(gold).of).toBe("color");
    expect(measureFinisher(bath).of).toBe("finisher");
    expect(measureShifter(swing).of).toBe("shifter");
  });
});
