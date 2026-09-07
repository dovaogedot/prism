/**
 * Metric is stored; imperial is derived.
 *
 * TASK.md requires product measurements in both systems. Storing both would
 * create two sources of truth for one fact, so imperial exists only as these
 * pure functions over the metric values.
 *
 * The measurements belong to the thing itself rather than to a container,
 * because there is no container — and what there is to measure depends on what
 * the thing is. A color has a temperature, a reach, a coating and a weight. A
 * finisher has none of those; it has a coating, a grain and a weight.
 * A shifter is a mechanism, so it has a torque, a backlash and a weight.
 *
 * Weight is the one they share, because the requirement names it and because
 * everything in the shop has some.
 *
 * Postgres derives every metric value from the product's own stored facts, so
 * nothing here is ever the second copy of anything.
 */

import { match } from "ts-pattern";

const GRAMS_PER_OUNCE = 28.349523125;
const METERS_PER_FOOT = 0.3048;
const MILLIMETERS_PER_INCH = 25.4;
/** A mil is a thousandth of an inch, which is where surface grain is measured. */
const MICROMETERS_PER_MIL = 25.4;
/**
 * A microinch is a millionth of one, which is where coating thickness is
 * measured by anyone who buys their instruments in inches. Same 25.4 as the
 * mil, three decimal places further down.
 */
const NANOMETERS_PER_MICROINCH = 25.4;
const NEWTON_METERS_PER_POUND_FOOT = 1.3558179483314004;

/** Absolute zero, in degrees Celsius. */
const CELSIUS_OFFSET = 273.15;

/**
 * Half-away-from-zero to `decimals` places, avoiding float display artifacts.
 *
 * Rounds the magnitude and puts the sign back, because `Math.round` is
 * half-*up*: it sends -273.15 to -273.1 while sending 273.15 to 273.2. Nothing
 * in the catalog is negative today — Celsius bottoms out well above zero — but
 * a rounding helper that disagrees with its own name is a trap.
 */
export const roundTo = (decimals: number, value: number): number => {
  const factor = 10 ** decimals;
  const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;

  return value < 0 ? -magnitude : magnitude;
};

/** Grams as ounces, to two decimals. */
export const gramsToOunces = (grams: number): number =>
  roundTo(2, grams / GRAMS_PER_OUNCE);

/** Meters as feet, to one decimal. */
export const metersToFeet = (meters: number): number =>
  roundTo(1, meters / METERS_PER_FOOT);

/** Kelvin as degrees Celsius, to one decimal. */
export const kelvinToCelsius = (kelvin: number): number =>
  roundTo(1, kelvin - CELSIUS_OFFSET);

/**
 * Straight through Celsius rather than via the direct 9/5 formula, so the two
 * conversions cannot drift apart.
 */
export const kelvinToFahrenheit = (kelvin: number): number =>
  roundTo(1, (kelvin - CELSIUS_OFFSET) * (9 / 5) + 32);

/** Micrometers as mils, to two decimals. */
export const micrometersToMils = (micrometers: number): number =>
  roundTo(2, micrometers / MICROMETERS_PER_MIL);

/** Nanometers as microinches, to two decimals. */
export const nanometersToMicroinches = (nanometers: number): number =>
  roundTo(2, nanometers / NANOMETERS_PER_MICROINCH);

/** Newton-meters as pound-feet, to two decimals. */
export const newtonMetersToPoundFeet = (newtonMeters: number): number =>
  roundTo(2, newtonMeters / NEWTON_METERS_PER_POUND_FOOT);

/** Millimeters as inches, to three decimals. */
export const millimetersToInches = (millimeters: number): number =>
  roundTo(3, millimeters / MILLIMETERS_PER_INCH);

/* --------------------------------------------------------------- by kind */

/**
 * What a color measures. Temperature is carried in kelvin because that is what
 * the column stores; nothing displays it, since a shopper reading "6208 K" is
 * being told about a light source rather than about this color.
 */
export type ColorMetric = Readonly<{
  temperatureKelvin: number;
  reachMeters: number;
  /** Thickness of the interference coating. Zero for bare paint. */
  coatingNanometers: number;
  weightGrams: number;
}>;

/** A color's measurements in both systems, ready to display. */
export type ColorMeasurements = Readonly<{
  of: "color";
  metric: Readonly<{
    temperatureCelsius: number;
    reachMeters: number;
    coatingNanometers: number;
    weightGrams: number;
  }>;
  imperial: Readonly<{
    temperatureFahrenheit: number;
    reachFeet: number;
    coatingMicroinches: number;
    weightOunces: number;
  }>;
}>;

/**
 * The one thing a finisher has to measure.
 *
 * A finisher does one thing, so it has one dimension and it is the one belonging to
 * that thing: a finisher sold for the surface it leaves quotes a grain, one sold
 * for a coating quotes a thickness, one sold for a glow quotes how far that
 * glow carries.
 */
export type FinisherDimension =
  | Readonly<{ applies: "roughness"; grainMicrometers: number }>
  | Readonly<{ applies: "coating"; coatingNanometers: number }>
  | Readonly<{ applies: "emission"; reachMeters: number }>;

/** What a finisher measures: its one dimension, and the weight they all have. */
export type FinisherMetric = Readonly<{ weightGrams: number }> & FinisherDimension;

/** The same one dimension, in the vocabulary that buys its instruments in inches. */
export type FinisherImperialDimension =
  | Readonly<{ applies: "roughness"; grainMils: number }>
  | Readonly<{ applies: "coating"; coatingMicroinches: number }>
  | Readonly<{ applies: "emission"; reachFeet: number }>;

/** A finisher's measurements in both systems, ready to display. */
export type FinisherMeasurements = Readonly<{
  of: "finisher";
  metric: FinisherMetric;
  imperial: Readonly<{ weightOunces: number }> & FinisherImperialDimension;
}>;

/** What a shifter measures. */
export type ShifterMetric = Readonly<{
  torqueNewtonMeters: number;
  backlashMillimeters: number;
  weightGrams: number;
}>;

/** A shifter's measurements in both systems, ready to display. */
export type ShifterMeasurements = Readonly<{
  of: "shifter";
  metric: ShifterMetric;
  imperial: Readonly<{
    torquePoundFeet: number;
    backlashInches: number;
    weightOunces: number;
  }>;
}>;

/**
 * One set of facts, two vocabularies — and a different set of facts per kind,
 * mirroring `ProductSpec`. The tag is `of` rather than `kind` so that a
 * measurement block and the product carrying it can be matched on separately.
 */
export type Measurements =
  | ColorMeasurements
  | FinisherMeasurements
  | ShifterMeasurements;

/** Both systems for a color, from the metric values Postgres generated. */
export const measureColor = (metric: ColorMetric): ColorMeasurements => ({
  of: "color",
  metric: {
    temperatureCelsius: kelvinToCelsius(metric.temperatureKelvin),
    reachMeters: metric.reachMeters,
    coatingNanometers: metric.coatingNanometers,
    weightGrams: metric.weightGrams,
  },
  imperial: {
    temperatureFahrenheit: kelvinToFahrenheit(metric.temperatureKelvin),
    reachFeet: metersToFeet(metric.reachMeters),
    coatingMicroinches: nanometersToMicroinches(metric.coatingNanometers),
    weightOunces: gramsToOunces(metric.weightGrams),
  },
});

/**
 * A finisher's one dimension, converted. Weight is added by the caller, being the
 * half every finisher shares.
 */
const finisherImperial = (metric: FinisherMetric): FinisherImperialDimension =>
  match(metric)
    .with({ applies: "roughness" }, ({ grainMicrometers }) => ({
      applies: "roughness" as const,
      grainMils: micrometersToMils(grainMicrometers),
    }))
    .with({ applies: "coating" }, ({ coatingNanometers }) => ({
      applies: "coating" as const,
      coatingMicroinches: nanometersToMicroinches(coatingNanometers),
    }))
    .with({ applies: "emission" }, ({ reachMeters }) => ({
      applies: "emission" as const,
      reachFeet: metersToFeet(reachMeters),
    }))
    .exhaustive();

/** Both systems for a finisher, from the metric values Postgres generated. */
export const measureFinisher = (metric: FinisherMetric): FinisherMeasurements => ({
  of: "finisher",
  metric,
  imperial: {
    ...finisherImperial(metric),
    weightOunces: gramsToOunces(metric.weightGrams),
  },
});

/** Both systems for a shifter, from the metric values Postgres generated. */
export const measureShifter = (metric: ShifterMetric): ShifterMeasurements => ({
  of: "shifter",
  metric,
  imperial: {
    torquePoundFeet: newtonMetersToPoundFeet(metric.torqueNewtonMeters),
    backlashInches: millimetersToInches(metric.backlashMillimeters),
    weightOunces: gramsToOunces(metric.weightGrams),
  },
});

/* ------------------------------------------------------------- as written */

/** Which vocabulary a reader has asked for the numbers in. */
export type UnitSystem = "metric" | "imperial";

/** One measurement, named and written in the unit it is read in. */
export type MeasurementRow = Readonly<{ label: string; value: string }>;

/**
 * The one dimension a finisher quotes, in metric.
 *
 * Which dimension follows from what the finisher does, because a dimension nothing
 * about the finisher produces is not a fact about it. A finisher sold for the surface it
 * leaves quotes the grain of that surface; one sold for a coating quotes the
 * film's thickness; one sold for a glow quotes how far the glow carries.
 */
const finisherMetricRow = (metric: FinisherMetric): MeasurementRow =>
  match(metric)
    .with({ applies: "roughness" }, ({ grainMicrometers }) => ({
      label: "Grain",
      value: `${grainMicrometers} µm`,
    }))
    .with({ applies: "coating" }, ({ coatingNanometers }) => ({
      label: "Coating",
      value: `${coatingNanometers} nm`,
    }))
    .with({ applies: "emission" }, ({ reachMeters }) => ({
      label: "Reach",
      value: `${reachMeters} m`,
    }))
    .exhaustive();

/** The same dimension, in the other vocabulary. */
const finisherImperialRow = (imperial: FinisherImperialDimension): MeasurementRow =>
  match(imperial)
    .with({ applies: "roughness" }, ({ grainMils }) => ({
      label: "Grain",
      value: `${grainMils} mil`,
    }))
    .with({ applies: "coating" }, ({ coatingMicroinches }) => ({
      label: "Coating",
      value: `${coatingMicroinches} µin`,
    }))
    .with({ applies: "emission" }, ({ reachFeet }) => ({
      label: "Reach",
      value: `${reachFeet} ft`,
    }))
    .exhaustive();

/**
 * A product's measurements as the rows a page prints, in the system asked for.
 *
 * The rows differ by kind because what there is to measure differs by kind, so
 * no row here ever reads "—": a kind that has no answer for something has no
 * row for it either. Weight is last everywhere, being the one they share.
 *
 * Kelvin is deliberately absent. It is what the column stores, being the unit
 * the derivation is defined in, but "6208 K" describes a light source rather
 * than a color — °C and °F are the two a shopper can act on.
 */
export const measurementRows = (
  measurements: Measurements,
  system: UnitSystem,
): readonly MeasurementRow[] =>
  match([measurements, system] as const)
    .with([{ of: "color" }, "metric"], ([{ metric }]) => [
      { label: "Temperature", value: `${metric.temperatureCelsius} °C` },
      { label: "Reach", value: `${metric.reachMeters} m` },
      { label: "Coating", value: `${metric.coatingNanometers} nm` },
      { label: "Weight", value: `${metric.weightGrams} g` },
    ])
    .with([{ of: "color" }, "imperial"], ([{ imperial }]) => [
      { label: "Temperature", value: `${imperial.temperatureFahrenheit} °F` },
      { label: "Reach", value: `${imperial.reachFeet} ft` },
      { label: "Coating", value: `${imperial.coatingMicroinches} µin` },
      { label: "Weight", value: `${imperial.weightOunces} oz` },
    ])
    .with([{ of: "finisher" }, "metric"], ([{ metric }]) => [
      finisherMetricRow(metric),
      { label: "Weight", value: `${metric.weightGrams} g` },
    ])
    .with([{ of: "finisher" }, "imperial"], ([{ imperial }]) => [
      finisherImperialRow(imperial),
      { label: "Weight", value: `${imperial.weightOunces} oz` },
    ])
    .with([{ of: "shifter" }, "metric"], ([{ metric }]) => [
      { label: "Torque", value: `${metric.torqueNewtonMeters} N·m` },
      { label: "Backlash", value: `${metric.backlashMillimeters} mm` },
      { label: "Weight", value: `${metric.weightGrams} g` },
    ])
    .with([{ of: "shifter" }, "imperial"], ([{ imperial }]) => [
      { label: "Torque", value: `${imperial.torquePoundFeet} lbf·ft` },
      { label: "Backlash", value: `${imperial.backlashInches} in` },
      { label: "Weight", value: `${imperial.weightOunces} oz` },
    ])
    .exhaustive();
