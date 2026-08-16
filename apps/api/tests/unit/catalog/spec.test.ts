/**
 * `toProductSpec` is the seam between a table full of nullable columns and a
 * domain where absence is not representable. These pin both halves: that a
 * well-formed row of each kind comes back whole, and that a row the variant
 * constraint could not have produced comes back as nothing rather than as a
 * product with holes in it.
 */

import { describe, expect, it } from "vitest";
import { Option } from "@prism/shared";
import {
  toMeasurements,
  toProductSpec,
  type MeasurementColumns,
  type SpecColumns,
} from "../../../src/modules/catalog/spec.ts";

/** Every column null, so each case below names only what it needs. */
const empty: SpecColumns = {
  kind: "color",
  hex: null,
  finish: null,
  hue: null,
  saturation: null,
  lightness: null,
  durability: null,
  arcDegrees: null,
  direction: null,
};

const color: SpecColumns = {
  ...empty,
  kind: "color",
  hex: "#ff8800",
  finish: "gloss",
  hue: 32,
  saturation: 100,
  lightness: 50,
};

const finisher: SpecColumns = {
  ...empty,
  kind: "finisher",
  finish: "matte",
  durability: 12,
};

const shifter: SpecColumns = {
  ...empty,
  kind: "shifter",
  direction: "cw",
  arcDegrees: 90,
};

describe("toProductSpec", () => {
  it("builds a color from its hex, finish and three channels", () => {
    expect(toProductSpec(color)).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("builds a finisher from its finish and durability", () => {
    expect(toProductSpec(finisher)).toEqual(
      Option.some({ kind: "finisher", finish: "matte", durability: 12 }),
    );
  });

  it("builds a shifter from its direction and arc", () => {
    expect(toProductSpec(shifter)).toEqual(
      Option.some({ kind: "shifter", direction: "cw", arcDegrees: 90 }),
    );
  });

  it("carries nothing from the other variants' columns", () => {
    // A row that somehow held a shifter's arc alongside a color would still
    // produce a plain color: the spec is built from the branch, not the row.
    expect(toProductSpec({ ...color, arcDegrees: 90, direction: "ccw" })).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("keeps a zero arc and a zero channel, which are values and not absence", () => {
    expect(toProductSpec({ ...color, hue: 0, lightness: 0 })).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 0,
        saturation: 100,
        lightness: 0,
      }),
    );
  });

  it("refuses a color with no hex", () => {
    expect(toProductSpec({ ...color, hex: null })).toEqual(Option.none);
  });

  it("refuses a color missing a derived channel", () => {
    expect(toProductSpec({ ...color, saturation: null })).toEqual(Option.none);
  });

  it("refuses a finisher with no durability", () => {
    expect(toProductSpec({ ...finisher, durability: null })).toEqual(Option.none);
  });

  it("refuses a shifter with no direction", () => {
    expect(toProductSpec({ ...shifter, direction: null })).toEqual(Option.none);
  });

  it("refuses a row with a kind and nothing else", () => {
    expect(toProductSpec(empty)).toEqual(Option.none);
    expect(toProductSpec({ ...empty, kind: "finisher" })).toEqual(Option.none);
    expect(toProductSpec({ ...empty, kind: "shifter" })).toEqual(Option.none);
  });
});

/* ---------------------------------------------------------- measurements */

const noMeasurements: MeasurementColumns = {
  kind: "color",
  temperatureKelvin: null,
  reachCentimeters: null,
  coverageSquareCentimeters: null,
  grainMicrometers: null,
  torqueMillinewtonMeters: null,
  backlashMicrometers: null,
  weightGrams: 120,
};

const colorColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "color",
  temperatureKelvin: 2596,
  reachCentimeters: 29_350,
  // A color has a grain too, because grain comes from the finish and a color
  // has one. It is simply never part of a color's measurements.
  grainMicrometers: 3,
  weightGrams: 99,
};

const finisherColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "finisher",
  coverageSquareCentimeters: 252_000,
  grainMicrometers: 34,
  weightGrams: 235,
};

const shifterColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "shifter",
  torqueMillinewtonMeters: 5400,
  backlashMicrometers: 636,
  weightGrams: 249,
};

describe("toMeasurements", () => {
  it("scales a color's columns to the units a shopper reads", () => {
    // Centimetres in the column so it stays an exact integer; metres on screen.
    expect(toMeasurements(colorColumns)).toEqual(
      Option.some({
        of: "color",
        metric: {
          temperatureCelsius: 2322.9,
          reachMeters: 293.5,
          weightGrams: 99,
        },
        imperial: {
          temperatureFahrenheit: 4213.1,
          reachFeet: 962.9,
          weightOunces: 3.49,
        },
      }),
    );
  });

  it("scales a finisher's coverage from square centimetres", () => {
    // The area trap: 252 000 cm² is 25.2 m², not 2520.
    const measurements = toMeasurements(finisherColumns);

    expect(measurements).toEqual(
      Option.some({
        of: "finisher",
        metric: {
          coverageSquareMeters: 25.2,
          grainMicrometers: 34,
          weightGrams: 235,
        },
        imperial: {
          coverageSquareFeet: 271.3,
          grainMils: 1.34,
          weightOunces: 8.29,
        },
      }),
    );
  });

  it("scales a shifter's torque and backlash out of their thousandths", () => {
    expect(toMeasurements(shifterColumns)).toEqual(
      Option.some({
        of: "shifter",
        metric: {
          torqueNewtonMeters: 5.4,
          backlashMillimeters: 0.64,
          weightGrams: 249,
        },
        imperial: {
          torquePoundFeet: 3.98,
          backlashInches: 0.025,
          weightOunces: 8.78,
        },
      }),
    );
  });

  it("leaves out the columns that belong to another kind", () => {
    const finisher = toMeasurements(finisherColumns);

    // A color's grain is present in the row and absent from the answer.
    expect(Option.isSome(finisher) && "grainMicrometers" in finisher.value.metric).toBe(
      true,
    );

    const color = toMeasurements(colorColumns);
    expect(Option.isSome(color) && "grainMicrometers" in color.value.metric).toBe(false);
  });

  it("refuses a row missing the measurement its kind requires", () => {
    expect(toMeasurements({ ...colorColumns, reachCentimeters: null })).toEqual(
      Option.none,
    );
    expect(
      toMeasurements({ ...finisherColumns, coverageSquareCentimeters: null }),
    ).toEqual(Option.none);
    expect(toMeasurements({ ...shifterColumns, backlashMicrometers: null })).toEqual(
      Option.none,
    );
  });
});
