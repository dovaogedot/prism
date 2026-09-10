export type { Brand } from "./fp/brand.ts";

export { Option } from "./fp/option.ts";
export type { Some, None } from "./fp/option.ts";

export {
  roundTo,
  gramsToOunces,
  metersToFeet,
  kelvinToCelsius,
  kelvinToFahrenheit,
  micrometersToMils,
  nanometersToMicroinches,
  newtonMetersToPoundFeet,
  millimetersToInches,
  measureColor,
  measureFinisher,
  measureShifter,
  measurementRows,
} from "./domain/units.ts";
export type {
  ColorMetric,
  FinisherDimension,
  FinisherImperialDimension,
  FinisherMetric,
  ShifterMetric,
  ColorMeasurements,
  FinisherMeasurements,
  ShifterMeasurements,
  Measurements,
  MeasurementRow,
  UnitSystem,
} from "./domain/units.ts";

export {
  parseHex,
  isHexColor,
  toRgb,
  saturationOf,
  relativeLuminance,
} from "./domain/color.ts";
export type { HexColor, Rgb } from "./domain/color.ts";

export { CURRENCY, isCents, formatPrice } from "./domain/money.ts";
export type { Cents } from "./domain/money.ts";

export {
  httpStatusByTag,
  messageByTag,
  httpStatusOf,
  messageOf,
  TAGLESS_ERRORS,
  toErrorResponse,
} from "./domain/errors.ts";
export type {
  DomainError,
  DomainErrorTag,
  TaglessDomainErrorTag,
  ValidationIssue,
  ErrorResponse,
} from "./domain/errors.ts";

export * from "./contracts/auth.ts";
export * from "./contracts/catalog.ts";
export * from "./contracts/search-terms.ts";
export * from "./contracts/stills.ts";
