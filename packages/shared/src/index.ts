export type { Brand } from "./fp/brand.ts";

export { Option } from "./fp/option.ts";
export type { Some, None } from "./fp/option.ts";

export {
  roundTo,
  gramsToOunces,
  metersToFeet,
  kelvinToCelsius,
  kelvinToFahrenheit,
  squareMetersToSquareFeet,
  micrometersToMils,
  newtonMetersToPoundFeet,
  millimetersToInches,
  measureColor,
  measureFinisher,
  measureShifter,
} from "./domain/units.ts";
export type {
  ColorMetric,
  FinisherMetric,
  ShifterMetric,
  ColorMeasurements,
  FinisherMeasurements,
  ShifterMeasurements,
  Measurements,
} from "./domain/units.ts";

export {
  parseHex,
  isHexColor,
  toRgb,
  relativeLuminance,
  contrastRatio,
  readableInkOn,
} from "./domain/color.ts";
export type { HexColor, Rgb, Ink } from "./domain/color.ts";

export {
  CURRENCY,
  isCents,
  parseCents,
  formatAmount,
  formatPrice,
} from "./domain/money.ts";
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
export * from "./contracts/tags.ts";
