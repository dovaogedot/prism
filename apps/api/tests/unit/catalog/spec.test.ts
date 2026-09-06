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
  roughness: null,
  coatingNanometers: null,
  emission: null,
  hue: null,
  saturation: null,
  lightness: null,
  family: null,
  arcDegrees: null,
  direction: null,
};

const color: SpecColumns = {
  ...empty,
  kind: "color",
  hex: "#ff8800",
  roughness: 18,
  coatingNanometers: 300,
  emission: 0,
  hue: 32,
  saturation: 100,
  lightness: 50,
  family: "orange",
};

/**
 * One tin per amount. A tin does one thing, so the row carries one number and
 * the other two arrive absent — the table refuses any other shape.
 */
const roughnessTin: SpecColumns = { ...empty, kind: "finisher", roughness: 88 };
const coatingTin: SpecColumns = { ...empty, kind: "finisher", coatingNanometers: 300 };
const emissionTin: SpecColumns = { ...empty, kind: "finisher", emission: 80 };

const shifter: SpecColumns = {
  ...empty,
  kind: "shifter",
  direction: "cw",
  arcDegrees: 90,
};

describe("toProductSpec", () => {
  it("builds a color from its hex, its three amounts and three channels", () => {
    expect(toProductSpec(color)).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        family: "orange",
        roughness: 18,
        coatingNanometers: 300,
        emission: 0,
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("reads a tin as the one amount it carries", () => {
    expect(toProductSpec(roughnessTin)).toEqual(
      Option.some({ kind: "finisher", applies: "roughness", roughness: 88 }),
    );
    expect(toProductSpec(coatingTin)).toEqual(
      Option.some({ kind: "finisher", applies: "coating", coatingNanometers: 300 }),
    );
    expect(toProductSpec(emissionTin)).toEqual(
      Option.some({ kind: "finisher", applies: "emission", emission: 80 }),
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
        family: "orange",
        roughness: 18,
        coatingNanometers: 300,
        emission: 0,
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("keeps a zero arc and a zero channel, which are values and not absence", () => {
    // Iridescence and emission are the same story: nought is what most colors
    // have, and a branch that treated it as a missing column would drop them.
    expect(
      toProductSpec({ ...color, hue: 0, lightness: 0, coatingNanometers: 0 }),
    ).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        family: "orange",
        roughness: 18,
        coatingNanometers: 0,
        emission: 0,
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

  it("refuses a tin that lost the one amount it had", () => {
    expect(toProductSpec({ ...roughnessTin, roughness: null })).toEqual(Option.none);
    expect(toProductSpec({ ...coatingTin, coatingNanometers: null })).toEqual(
      Option.none,
    );
    expect(toProductSpec({ ...emissionTin, emission: null })).toEqual(Option.none);
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
  coatingNanometers: null,
  grainMicrometers: null,
  finisherReachCentimeters: null,
  torqueMillinewtonMeters: null,
  backlashMicrometers: null,
  weightGrams: 120,
};

const colorColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "color",
  temperatureKelvin: 2596,
  reachCentimeters: 29_350,
  coatingNanometers: 320,
  // A color has a grain too, because grain comes from the roughness and a
  // color has one. It is simply never part of a color's measurements.
  grainMicrometers: 3,
  weightGrams: 99,
};

/**
 * One dimension per tin, generated from the one amount it carries, so the
 * columns belonging to the other two amounts are absent here too.
 */
const roughnessTinColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "finisher",
  grainMicrometers: 34,
  weightGrams: 235,
};

const coatingTinColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "finisher",
  coatingNanometers: 320,
  weightGrams: 235,
};

const emissionTinColumns: MeasurementColumns = {
  ...noMeasurements,
  kind: "finisher",
  finisherReachCentimeters: 430,
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
    // Centimeters in the column so it stays an exact integer; meters on screen.
    expect(toMeasurements(colorColumns)).toEqual(
      Option.some({
        of: "color",
        metric: {
          temperatureCelsius: 2322.9,
          reachMeters: 293.5,
          coatingNanometers: 320,
          weightGrams: 99,
        },
        imperial: {
          temperatureFahrenheit: 4213.1,
          reachFeet: 962.9,
          coatingMicroinches: 12.6,
          weightOunces: 3.49,
        },
      }),
    );
  });

  it("gives a tin the one dimension its own effect has, in both systems", () => {
    expect(toMeasurements(roughnessTinColumns)).toEqual(
      Option.some({
        of: "finisher",
        metric: { applies: "roughness", grainMicrometers: 34, weightGrams: 235 },
        imperial: { applies: "roughness", grainMils: 1.34, weightOunces: 8.29 },
      }),
    );

    expect(toMeasurements(coatingTinColumns)).toEqual(
      Option.some({
        of: "finisher",
        metric: { applies: "coating", coatingNanometers: 320, weightGrams: 235 },
        imperial: { applies: "coating", coatingMicroinches: 12.6, weightOunces: 8.29 },
      }),
    );

    // Centimeters in the column, meters on screen, exactly as a color's reach.
    expect(toMeasurements(emissionTinColumns)).toEqual(
      Option.some({
        of: "finisher",
        metric: { applies: "emission", reachMeters: 4.3, weightGrams: 235 },
        imperial: { applies: "emission", reachFeet: 14.1, weightOunces: 8.29 },
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
    // A color's grain is present in the row and absent from the answer: grain
    // comes from roughness and every color has one, but it is not a fact a
    // color is sold on.
    const color = toMeasurements(colorColumns);
    expect(Option.isSome(color) && "grainMicrometers" in color.value.metric).toBe(false);

    // A tin sold for its coating quotes no grain, and one sold for its glow
    // quotes neither.
    const coating = toMeasurements(coatingTinColumns);
    expect(Option.isSome(coating) && "grainMicrometers" in coating.value.metric).toBe(
      false,
    );

    const emission = toMeasurements(emissionTinColumns);
    expect(
      Option.isSome(emission) && "coatingNanometers" in emission.value.metric,
    ).toBe(false);
  });

  it("refuses a row missing the measurement its kind requires", () => {
    expect(toMeasurements({ ...colorColumns, reachCentimeters: null })).toEqual(
      Option.none,
    );
    expect(
      toMeasurements({ ...roughnessTinColumns, grainMicrometers: null }),
    ).toEqual(Option.none);
    expect(toMeasurements({ ...shifterColumns, backlashMicrometers: null })).toEqual(
      Option.none,
    );
  });
});
