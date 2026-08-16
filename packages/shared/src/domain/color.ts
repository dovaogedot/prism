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

export type HexColor = Brand<string, "HexColor">;

export type Rgb = Readonly<{ red: number; green: number; blue: number }>;

/** Ink dark enough, or light enough, to read against a given swatch. */
export type Ink = "light" | "dark";

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

export const toRgb = (hex: HexColor): Rgb => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

/** WCAG 2.1 relative luminance: sRGB channels linearised, then weighted. */
export const relativeLuminance = (rgb: Rgb): number => {
  const linearise = (channel: number): number => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearise(rgb.red) +
    0.7152 * linearise(rgb.green) +
    0.0722 * linearise(rgb.blue)
  );
};

/**
 * WCAG 2.1 contrast ratio, `1` (identical) to `21` (black on white).
 * Level AA wants 4.5 for body text, 3 for large text.
 */
export const contrastRatio = (first: HexColor, second: HexColor): number => {
  const a = relativeLuminance(toRgb(first));
  const b = relativeLuminance(toRgb(second));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Which ink reads better on this swatch. The 0.179 threshold is where white
 * and black text achieve equal contrast against a background.
 */
export const readableInkOn = (hex: HexColor): Ink =>
  relativeLuminance(toRgb(hex)) > 0.179 ? "dark" : "light";
