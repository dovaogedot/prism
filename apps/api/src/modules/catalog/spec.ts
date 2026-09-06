/**
 * Where the database's tagged union becomes the domain's tagged union.
 *
 * `product_listing` is a base row LEFT JOINed to the one sub-table its kind
 * lives in, so every column belonging to the other two arrives null. Which
 * columns those are is decided by `kind`, and TypeScript cannot see that, so
 * this is the one place that has to look — after which nothing downstream sees
 * a null again.
 *
 * Pure: a row shape goes in and a `ProductSpec` comes out, which is what lets
 * it be tested without a database.
 */

import type {
  ColorFamily,
  Measurements,
  ProductKind,
  ProductSpec,
  ShiftDirection,
} from "@prism/shared";
import { COLOR_FAMILIES } from "@prism/shared";
import {
  measureColor,
  measureFinisher,
  measureShifter,
  Option,
  roundTo,
} from "@prism/shared";
import { match, P } from "ts-pattern";

/** Exactly the columns a spec is built from, and nothing else. */
export type SpecColumns = Readonly<{
  kind: ProductKind;
  hex: string | null;
  family: string | null;
  roughness: number | null;
  coatingNanometers: number | null;
  emission: number | null;
  hue: number | null;
  saturation: number | null;
  lightness: number | null;
  arcDegrees: number | null;
  direction: ShiftDirection | null;
}>;

/**
 * Whether the family a row carries is one this build knows.
 *
 * `color_family` and `COLOR_FAMILIES` hold the same list of landmarks, so a
 * mismatch means the two have drifted, and a color whose family cannot be named
 * is left out rather than named wrongly.
 */
const isColorFamily = (value: string): value is ColorFamily =>
  COLOR_FAMILIES.some((family) => family === value);

/**
 * `None` is unreachable while each sub-table holds: every branch requires
 * exactly the columns that table declares NOT NULL. It is an `Option` rather
 * than a thrown error because the honest response to a row that somehow lost
 * them is to leave it out of the catalog, not to take the catalog down with it.
 */
export const toProductSpec = (columns: SpecColumns): Option<ProductSpec> =>
  match(columns)
    .with(
      {
        kind: "color",
        hex: P.string,
        family: P.when(isColorFamily),
        roughness: P.number,
        coatingNanometers: P.number,
        emission: P.number,
        hue: P.number,
        saturation: P.number,
        lightness: P.number,
      },
      ({
        hex,
        family,
        roughness,
        coatingNanometers,
        emission,
        hue,
        saturation,
        lightness,
      }) =>
        Option.some<ProductSpec>({
          kind: "color",
          hex,
          family,
          roughness,
          coatingNanometers,
          emission,
          hue,
          saturation,
          lightness,
        }),
    )
    // A tin does one thing, so exactly one of the three arrives and the branch
    // that matches it is the branch that says what the tin is.
    .with({ kind: "finisher", roughness: P.number }, ({ roughness }) =>
      Option.some<ProductSpec>({ kind: "finisher", applies: "roughness", roughness }),
    )
    .with({ kind: "finisher", coatingNanometers: P.number }, ({ coatingNanometers }) =>
      Option.some<ProductSpec>({
        kind: "finisher",
        applies: "coating",
        coatingNanometers,
      }),
    )
    .with({ kind: "finisher", emission: P.number }, ({ emission }) =>
      Option.some<ProductSpec>({ kind: "finisher", applies: "emission", emission }),
    )
    .with(
      { kind: "shifter", direction: P.not(P.nullish), arcDegrees: P.number },
      ({ direction, arcDegrees }) =>
        Option.some<ProductSpec>({ kind: "shifter", direction, arcDegrees }),
    )
    .otherwise(() => Option.none);

/**
 * The measurement columns, which are nullable for the same reason: each is
 * generated from facts only one kind has, so each is present exactly where it
 * belongs. `weight_grams` is the one every kind has and the only one NOT NULL.
 */
export type MeasurementColumns = Readonly<{
  kind: ProductKind;
  temperatureKelvin: number | null;
  reachCentimeters: number | null;
  /** Stored rather than generated: a coating's thickness is a fact, not a derivation. */
  coatingNanometers: number | null;
  grainMicrometers: number | null;
  /** How far a tin's glow carries. A color's own reach is `reachCentimeters`. */
  finisherReachCentimeters: number | null;
  torqueMillinewtonMeters: number | null;
  backlashMicrometers: number | null;
  weightGrams: number;
}>;

/**
 * Columns to measurements, scaling each to the unit a shopper reads on the way.
 *
 * The database stores the smallest whole unit so the columns stay exact
 * integers — centimeters, millinewton-meters, micrometers, nanometers.
 * Dividing here rather than in SQL keeps that decision in one place, and keeps
 * the generated columns free of a rounding rule that is really presentation.
 *
 * `None` is unreachable for the same reason as `toProductSpec`.
 */
export const toMeasurements = (
  columns: MeasurementColumns,
): Option<Measurements> =>
  match(columns)
    .with(
      {
        kind: "color",
        temperatureKelvin: P.number,
        reachCentimeters: P.number,
        coatingNanometers: P.number,
      },
      ({ temperatureKelvin, reachCentimeters, coatingNanometers, weightGrams }) =>
        Option.some<Measurements>(
          measureColor({
            temperatureKelvin,
            reachMeters: roundTo(2, reachCentimeters / 100),
            coatingNanometers,
            weightGrams,
          }),
        ),
    )
    // One dimension per tin, and it is the one its own effect has.
    .with(
      { kind: "finisher", grainMicrometers: P.number },
      ({ grainMicrometers, weightGrams }) =>
        Option.some<Measurements>(
          measureFinisher({ applies: "roughness", grainMicrometers, weightGrams }),
        ),
    )
    .with(
      { kind: "finisher", coatingNanometers: P.number },
      ({ coatingNanometers, weightGrams }) =>
        Option.some<Measurements>(
          measureFinisher({ applies: "coating", coatingNanometers, weightGrams }),
        ),
    )
    .with(
      { kind: "finisher", finisherReachCentimeters: P.number },
      ({ finisherReachCentimeters, weightGrams }) =>
        Option.some<Measurements>(
          measureFinisher({
            applies: "emission",
            reachMeters: roundTo(2, finisherReachCentimeters / 100),
            weightGrams,
          }),
        ),
    )
    .with(
      {
        kind: "shifter",
        torqueMillinewtonMeters: P.number,
        backlashMicrometers: P.number,
      },
      ({ torqueMillinewtonMeters, backlashMicrometers, weightGrams }) =>
        Option.some<Measurements>(
          measureShifter({
            torqueNewtonMeters: roundTo(2, torqueMillinewtonMeters / 1000),
            backlashMillimeters: roundTo(2, backlashMicrometers / 1000),
            weightGrams,
          }),
        ),
    )
    .otherwise(() => Option.none);
