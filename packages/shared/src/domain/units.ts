/**
 * Metric is stored; imperial is derived.
 *
 * TASK.md requires product measurements in both systems. Storing both would
 * create two sources of truth for one fact, so imperial exists only as this
 * pure function over the metric values.
 *
 * The measurements themselves belong to the color rather than to a container:
 * how warm it burns, how far it still reads, how heavy it looks. Postgres
 * derives all three from the hex, so nothing here is ever the second copy of
 * anything.
 */

const GRAMS_PER_OUNCE = 28.349523125;
const METERS_PER_FOOT = 0.3048;

/** Absolute zero, in degrees Celsius. */
const CELSIUS_OFFSET = 273.15;

export type MetricMeasurements = Readonly<{
  /** Warmth. Kelvin is the stored form; Celsius is one subtraction away. */
  temperatureKelvin: number;
  /** How far away the color still reads as itself. */
  reachMeters: number;
  /** Visual weight — how heavy the color looks, not the mass of anything. */
  weightGrams: number;
}>;

export type ImperialMeasurements = Readonly<{
  temperatureFahrenheit: number;
  reachFeet: number;
  weightOunces: number;
}>;

export type Measurements = Readonly<{
  metric: MetricMeasurements & Readonly<{ temperatureCelsius: number }>;
  imperial: ImperialMeasurements;
}>;

/**
 * Half-away-from-zero to `decimals` places, avoiding float display artefacts.
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

export const gramsToOunces = (grams: number): number =>
  roundTo(2, grams / GRAMS_PER_OUNCE);

export const metersToFeet = (meters: number): number =>
  roundTo(1, meters / METERS_PER_FOOT);

export const kelvinToCelsius = (kelvin: number): number =>
  roundTo(1, kelvin - CELSIUS_OFFSET);

/**
 * Straight through Celsius rather than via the direct 9/5 formula, so the two
 * conversions cannot drift apart.
 */
export const kelvinToFahrenheit = (kelvin: number): number =>
  roundTo(1, (kelvin - CELSIUS_OFFSET) * (9 / 5) + 32);

export const toImperial = (metric: MetricMeasurements): ImperialMeasurements => ({
  temperatureFahrenheit: kelvinToFahrenheit(metric.temperatureKelvin),
  reachFeet: metersToFeet(metric.reachMeters),
  weightOunces: gramsToOunces(metric.weightGrams),
});

/** What the API hands to clients: one set of facts, two vocabularies. */
export const measure = (metric: MetricMeasurements): Measurements => ({
  metric: { ...metric, temperatureCelsius: kelvinToCelsius(metric.temperatureKelvin) },
  imperial: toImperial(metric),
});
