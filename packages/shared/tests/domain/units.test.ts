import { describe, expect, it } from "vitest";
import {
  gramsToOunces,
  kelvinToCelsius,
  kelvinToFahrenheit,
  measureColor,
  measureFinisher,
  measurementRows,
  measureShifter,
  metersToFeet,
  micrometersToMils,
  millimetersToInches,
  nanometersToMicroinches,
  newtonMetersToPoundFeet,
  roundTo,
  type ColorMetric,
  type FinisherMetric,
  type ShifterMetric,
} from "../../src/index.ts";

/** Ceremonial Gold: hue 42°, saturation 87%, lightness 64%. */
const gold: ColorMetric = {
  temperatureKelvin: 2596,
  reachMeters: 293.5,
  coatingNanometers: 320,
  weightGrams: 99,
};

/** A matte bath, sold for the surface it leaves. */
const bath: FinisherMetric = {
  applies: "roughness",
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

describe("micrometersToMils", () => {
  it("puts a mil at 25.4 micrometers, being a thousandth of an inch", () => {
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
  it("puts an inch at 25.4 millimeters", () => {
    expect(millimetersToInches(25.4)).toBe(1);
  });

  it("keeps enough places for a number that never leaves the sub-millimeter", () => {
    // Backlash is fractions of a millimeter, so two decimal places of inches
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
      coatingNanometers: 320,
      weightGrams: 99,
    });
    expect(measureColor(gold).metric).not.toHaveProperty("temperatureKelvin");
  });

  it("derives the imperial half rather than storing it", () => {
    expect(measureColor(gold).imperial).toEqual({
      temperatureFahrenheit: kelvinToFahrenheit(2596),
      reachFeet: metersToFeet(293.5),
      coatingMicroinches: nanometersToMicroinches(320),
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
  it("measures a finisher by what a finisher has", () => {
    // No temperature and no reach: a finisher has neither.
    expect(measureFinisher(bath)).toEqual({
      of: "finisher",
      metric: bath,
      imperial: {
        applies: "roughness",
        grainMils: micrometersToMils(34),
        weightOunces: gramsToOunces(235),
      },
    });
  });

  it("gives each kind of finisher the one dimension its own effect has", () => {
    // A finisher does one thing, so it quotes one dimension and it is the one
    // belonging to that thing. Weight is the only row all three share.
    const dimensions = (metric: FinisherMetric) =>
      Object.keys(measureFinisher(metric).metric)
        .filter((key) => key !== "applies")
        .sort();

    expect(dimensions(bath)).toEqual(["grainMicrometers", "weightGrams"]);
    expect(dimensions({ applies: "coating", coatingNanometers: 320, weightGrams: 255 }))
      .toEqual(["coatingNanometers", "weightGrams"]);
    expect(dimensions({ applies: "emission", reachMeters: 24.6, weightGrams: 281 }))
      .toEqual(["reachMeters", "weightGrams"]);
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

describe("nanometersToMicroinches", () => {
  it("converts a coating to the unit an inch-shop measures it in", () => {
    // A microinch is 25.4 nm exactly, the same ratio as the mil three decimal
    // places up. A 320 nm coating is a shade over twelve and a half of them.
    expect(nanometersToMicroinches(25.4)).toBe(1);
    expect(nanometersToMicroinches(320)).toBe(12.6);
  });

  it("gives bare paint no thickness", () => {
    expect(nanometersToMicroinches(0)).toBe(0);
  });
});

describe("measurementRows", () => {
  it("writes a color's four rows in the system asked for", () => {
    expect(measurementRows(measureColor(gold), "metric")).toEqual([
      { label: "Temperature", value: "2322.9 °C" },
      { label: "Reach", value: "293.5 m" },
      { label: "Coating", value: "320 nm" },
      { label: "Weight", value: "99 g" },
    ]);

    expect(measurementRows(measureColor(gold), "imperial")).toEqual([
      { label: "Temperature", value: "4213.1 °F" },
      { label: "Reach", value: "962.9 ft" },
      { label: "Coating", value: "12.6 µin" },
      { label: "Weight", value: "3.49 oz" },
    ]);
  });

  it("gives each finisher two rows: its own dimension, then its weight", () => {
    expect(measurementRows(measureFinisher(bath), "metric")).toEqual([
      { label: "Grain", value: "34 µm" },
      { label: "Weight", value: "235 g" },
    ]);

    expect(
      measurementRows(
        measureFinisher({ applies: "coating", coatingNanometers: 320, weightGrams: 255 }),
        "metric",
      ),
    ).toEqual([
      { label: "Coating", value: "320 nm" },
      { label: "Weight", value: "255 g" },
    ]);

    expect(
      measurementRows(
        measureFinisher({ applies: "emission", reachMeters: 24.6, weightGrams: 281 }),
        "imperial",
      ),
    ).toEqual([
      { label: "Reach", value: "80.7 ft" },
      { label: "Weight", value: "9.91 oz" },
    ]);
  });

  it("writes a shifter's rows as a mechanism's", () => {
    expect(measurementRows(measureShifter(swing), "metric")).toEqual([
      { label: "Torque", value: "5.4 N·m" },
      { label: "Backlash", value: "0.64 mm" },
      { label: "Weight", value: "249 g" },
    ]);

    expect(measurementRows(measureShifter(swing), "imperial")).toEqual([
      { label: "Torque", value: "3.98 lbf·ft" },
      { label: "Backlash", value: "0.025 in" },
      { label: "Weight", value: "8.78 oz" },
    ]);
  });

  it("ends every reading with the weight, which is the row all three share", () => {
    const measured = [
      measureColor(gold),
      measureFinisher(bath),
      measureShifter(swing),
    ] as const;

    for (const measurements of measured) {
      for (const system of ["metric", "imperial"] as const) {
        const rows = measurementRows(measurements, system);

        expect(rows.at(-1)).toEqual({
          label: "Weight",
          value: system === "metric" ? expect.stringMatching(/ g$/) : expect.stringMatching(/ oz$/),
        });
      }
    }
  });

  it("labels no row it has no number for", () => {
    // The point of the whole shape: a finisher has no temperature row reading zero,
    // because a finisher has no temperature.
    const labels = measurementRows(measureFinisher(bath), "metric").map(
      (row) => row.label,
    );

    expect(labels).not.toContain("Temperature");
    expect(labels).not.toContain("Torque");
  });
});
