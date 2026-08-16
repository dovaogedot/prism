/**
 * Where the database's tagged union becomes the domain's tagged union.
 *
 * `product` stores one discriminant and one nullable column per variant field,
 * with a CHECK constraint that spells out which columns each kind must and must
 * not have. TypeScript cannot see that constraint, so this is the one place
 * that has to look — after which nothing downstream sees a null again.
 *
 * Pure: a row shape goes in and a `ProductSpec` comes out, which is what lets
 * it be tested without a database.
 */

import type {
  Finish,
  Measurements,
  ProductKind,
  ProductSpec,
  ShiftDirection,
} from "@prism/shared";
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
  finish: Finish | null;
  hue: number | null;
  saturation: number | null;
  lightness: number | null;
  durability: number | null;
  arcDegrees: number | null;
  direction: ShiftDirection | null;
}>;

/**
 * `None` is unreachable while `product_variant_shape` holds: every branch here
 * requires exactly the columns that constraint requires, and forbids nothing it
 * allows. It is an `Option` rather than a thrown error because the honest
 * response to a row that broke the constraint is to leave it out of the
 * catalog, not to take the catalog down with it.
 */
export const toProductSpec = (columns: SpecColumns): Option<ProductSpec> =>
  match(columns)
    .with(
      {
        kind: "color",
        hex: P.string,
        finish: P.not(P.nullish),
        hue: P.number,
        saturation: P.number,
        lightness: P.number,
      },
      ({ hex, finish, hue, saturation, lightness }) =>
        Option.some<ProductSpec>({
          kind: "color",
          hex,
          finish,
          hue,
          saturation,
          lightness,
        }),
    )
    .with(
      { kind: "finisher", finish: P.not(P.nullish), durability: P.number },
      ({ finish, durability }) =>
        Option.some<ProductSpec>({ kind: "finisher", finish, durability }),
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
  coverageSquareCentimeters: number | null;
  grainMicrometers: number | null;
  torqueMillinewtonMeters: number | null;
  backlashMicrometers: number | null;
  weightGrams: number;
}>;

/**
 * Columns to measurements, scaling each to the unit a shopper reads on the way.
 *
 * The database stores the smallest whole unit so the columns stay exact
 * integers — centimetres, square centimetres, millinewton-metres, micrometres.
 * Dividing here rather than in SQL keeps that decision in one place, and keeps
 * the generated columns free of a rounding rule that is really presentation.
 *
 * `None` is unreachable while `product_variant_shape` holds, for the same
 * reason as `toProductSpec`.
 */
export const toMeasurements = (
  columns: MeasurementColumns,
): Option<Measurements> =>
  match(columns)
    .with(
      { kind: "color", temperatureKelvin: P.number, reachCentimeters: P.number },
      ({ temperatureKelvin, reachCentimeters, weightGrams }) =>
        Option.some<Measurements>(
          measureColor({
            temperatureKelvin,
            reachMeters: roundTo(2, reachCentimeters / 100),
            weightGrams,
          }),
        ),
    )
    .with(
      {
        kind: "finisher",
        coverageSquareCentimeters: P.number,
        grainMicrometers: P.number,
      },
      ({ coverageSquareCentimeters, grainMicrometers, weightGrams }) =>
        Option.some<Measurements>(
          measureFinisher({
            coverageSquareMeters: roundTo(1, coverageSquareCentimeters / 10_000),
            grainMicrometers,
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
