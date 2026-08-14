/**
 * Metric is stored; imperial is derived.
 *
 * TASK.md requires product weight and dimensions in both systems. Storing both
 * would create two sources of truth for one physical fact, so imperial exists
 * only as this pure function over the metric columns.
 */

const GRAMS_PER_OUNCE = 28.349523125;
const GRAMS_PER_POUND = 453.59237;
const MILLIMETRES_PER_INCH = 25.4;

export type MetricMeasurements = Readonly<{
  weightGrams: number;
  lengthMillimetres: number;
  widthMillimetres: number;
  heightMillimetres: number;
}>;

export type ImperialMeasurements = Readonly<{
  weightOunces: number;
  weightPounds: number;
  lengthInches: number;
  widthInches: number;
  heightInches: number;
}>;

export type Measurements = Readonly<{
  metric: MetricMeasurements;
  imperial: ImperialMeasurements;
}>;

/** Half-away-from-zero to `decimals` places, avoiding float display artefacts. */
export const roundTo = (decimals: number, value: number): number => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const gramsToOunces = (grams: number): number =>
  roundTo(2, grams / GRAMS_PER_OUNCE);

export const gramsToPounds = (grams: number): number =>
  roundTo(3, grams / GRAMS_PER_POUND);

export const millimetresToInches = (millimetres: number): number =>
  roundTo(2, millimetres / MILLIMETRES_PER_INCH);

export const toImperial = (metric: MetricMeasurements): ImperialMeasurements => ({
  weightOunces: gramsToOunces(metric.weightGrams),
  weightPounds: gramsToPounds(metric.weightGrams),
  lengthInches: millimetresToInches(metric.lengthMillimetres),
  widthInches: millimetresToInches(metric.widthMillimetres),
  heightInches: millimetresToInches(metric.heightMillimetres),
});

/** What the API hands to clients: one physical fact, two vocabularies. */
export const measure = (metric: MetricMeasurements): Measurements => ({
  metric,
  imperial: toImperial(metric),
});
