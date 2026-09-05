/**
 * Color is this shop's product, so `hex` is the one stored fact about it.
 *
 * Hue, saturation and lightness are NOT computed here — they are Postgres
 * generated columns derived from `hex`, because they need to be indexable for
 * range faceting. What lives here is only what the browser needs to paint a
 * swatch and pick legible ink to write on top of it.
 */

import type { Brand } from "../fp/brand.ts";
import { Option } from "../fp/option.ts";

/** A color as lowercase `#rrggbb`. The one stored fact about a color. */
export type HexColor = Brand<string, "HexColor">;

/** One color as three sRGB channels, each 0 to 255. */
export type Rgb = Readonly<{ red: number; green: number; blue: number }>;

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/**
 * Accepts `#RGB` and `#RRGGBB` in any case, with or without the hash, and
 * normalizes to lowercase `#rrggbb` so equality is string equality.
 */
export const parseHex = (input: string): Option<HexColor> => {
  const trimmed = input.trim().toLowerCase();
  const body = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;

  const expanded =
    body.length === 3
      ? body
          .split("")
          .map((character) => character + character)
          .join("")
      : body;

  const candidate = `#${expanded}`;
  return isHexColor(candidate) ? Option.some(candidate) : Option.none;
};

/**
 * The only way to mint a `HexColor`. A type predicate narrows into the brand
 * without a cast, so the validation and the type are the same step.
 */
export const isHexColor = (value: string): value is HexColor =>
  HEX_PATTERN.test(value);

/** The three sRGB channels of a hex color. */
export const toRgb = (hex: HexColor): Rgb => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

/**
 * How saturated a color is on the HSL scale, from 0 to 100.
 *
 * The same definition `hex_to_saturation` uses in the database, so a color
 * this calls saturated is one Postgres calls saturated too. Gray is 0 whatever
 * its lightness; a pure hue is 100 whatever its lightness.
 */
export const saturationOf = (rgb: Rgb): number => {
  const highest = Math.max(rgb.red, rgb.green, rgb.blue) / 255;
  const lowest = Math.min(rgb.red, rgb.green, rgb.blue) / 255;
  const chroma = highest - lowest;

  if (chroma === 0) return 0;

  const lightness = (highest + lowest) / 2;
  // Mathematically at most 1; clamped against rounding at the extremes.
  const ratio = chroma / (1 - Math.abs(2 * lightness - 1));

  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

/** WCAG 2.1 relative luminance: sRGB channels linearized, then weighted. */
export const relativeLuminance = (rgb: Rgb): number => {
  const linearize = (channel: number): number => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(rgb.red) +
    0.7152 * linearize(rgb.green) +
    0.0722 * linearize(rgb.blue)
  );
};
