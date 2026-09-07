/**
 * What a finisher does, drawn.
 *
 * A finisher has no color of its own, so there is nothing to photograph. What
 * there is to show is the effect: the colors a coating walks through as it
 * thickens, how far a glow carries, how sharp a reflection stays as the
 * surface roughens. Each finisher gets one picture of the effect it is bought for
 * and four of that effect over ordinary pigments, because "what does it do to
 * a red" is the question a shopper actually has.
 *
 * Rendered at seed time and stored as images, so a finisher's gallery is real
 * product images rather than a shape the client redraws. Flat raster: these
 * illustrate a surface, they do not pretend to be one.
 */

import { COATING_BOUNDS, ROUGHNESS_BOUNDS, type FinishApplication } from "@prism/shared";
import { match } from "ts-pattern";
import { encodePng, hexToRgb, type Rgb } from "./swatch.ts";

/** The gray every effect is shown on before it is shown over a pigment. */
const BARE_PIGMENT = "#8a8a8f";

/** Edge length of every image this renders, in pixels. */
const SIZE = 600;

/**
 * Refractive index of the coating, matching the storefront's renderer.
 *
 * Titanium dioxide. The index is what decides which wavelengths come back in
 * step, so a picture drawn with a different one would disagree with the slab.
 */
const COATING_IOR = 2.4;

/** The wavelength each channel is sampled at, in nanometers. */
const CHANNEL_NANOMETERS = { red: 610, green: 550, blue: 460 } as const;

/** The four pigments every effect is demonstrated over. */
export const DEMONSTRATION_COLORS = [
  { name: "red", hex: "#c0342c" },
  { name: "green", hex: "#2f8f4e" },
  { name: "blue", hex: "#2f5fc0" },
  { name: "yellow", hex: "#d8b32c" },
] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  red: from.red + (to.red - from.red) * amount,
  green: from.green + (to.green - from.green) * amount,
  blue: from.blue + (to.blue - from.blue) * amount,
});

/**
 * The color a coating of this thickness returns.
 *
 * Light coming back off the top of the film meets light coming back off the
 * paint underneath, having gone twice through it, so the two are out of step
 * by `2 · n · d`. The reflection off the top also flips, air being the thinner
 * medium, which puts the half-wave in `sin²`. Sampling that at one wavelength
 * per channel is what turns a thickness into a color.
 *
 * Zero thickness returns black, which is no film rather than a dark one; every
 * caller blends against a base rather than drawing this alone.
 */
export const coatingColor = (nanometers: number): Rgb => {
  const path = 2 * COATING_IOR * nanometers;
  const channel = (wavelength: number): number =>
    Math.sin((Math.PI * path) / wavelength) ** 2;

  return {
    red: channel(CHANNEL_NANOMETERS.red) * 255,
    green: channel(CHANNEL_NANOMETERS.green) * 255,
    blue: channel(CHANNEL_NANOMETERS.blue) * 255,
  };
};

/** A raster being drawn into, three channels per pixel, row-major. */
type Raster = Readonly<{ width: number; height: number; data: Float32Array }>;

const draw = (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Rgb,
): Raster => {
  const data = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(x, y);
      const at = (y * width + x) * 3;
      data[at] = pixel.red;
      data[at + 1] = pixel.green;
      data[at + 2] = pixel.blue;
    }
  }

  return { width, height, data };
};

/**
 * Box blur, separable, in two passes.
 *
 * Two passes over one axis each rather than one over a square, because a box
 * blur is the same either way and the separable form is O(radius) instead of
 * O(radius²). Not re-entrant: the working buffer is allocated per call.
 */
const blurred = (raster: Raster, radius: number): Raster => {
  if (radius < 1) return raster;

  const { width, height, data } = raster;
  const pass = (source: Float32Array, horizontal: boolean): Float32Array => {
    const target = new Float32Array(source.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;

    for (let a = 0; a < outer; a += 1) {
      for (let b = 0; b < inner; b += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let taken = 0;

        for (let offset = -radius; offset <= radius; offset += 1) {
          const c = b + offset;
          if (c < 0 || c >= inner) continue;

          const at = horizontal ? (a * width + c) * 3 : (c * width + a) * 3;
          red += source[at] ?? 0;
          green += source[at + 1] ?? 0;
          blue += source[at + 2] ?? 0;
          taken += 1;
        }

        const at = horizontal ? (a * width + b) * 3 : (b * width + a) * 3;
        target[at] = red / taken;
        target[at + 1] = green / taken;
        target[at + 2] = blue / taken;
      }
    }

    return target;
  };

  return { width, height, data: pass(pass(data, true), false) };
};

const encode = (raster: Raster): Buffer =>
  encodePng(raster.width, raster.height, (x, y) => {
    const at = (y * raster.width + x) * 3;

    return {
      red: raster.data[at] ?? 0,
      green: raster.data[at + 1] ?? 0,
      blue: raster.data[at + 2] ?? 0,
    };
  });

/** How far along the top-left to bottom-right diagonal a pixel sits, 0 to 1. */
const diagonal = (x: number, y: number): number => (x + y) / (2 * (SIZE - 1));

/* --------------------------------------------------------------- coating */

/**
 * Every color the coating can be, with this finisher's own thickness marked.
 *
 * Thickness runs left to right across the whole range a coating is sold in, so
 * the picture is the same for every iridescent finisher except for where the mark
 * falls — which is the point: it says what this one does against what the
 * range does.
 */
export const renderCoatingSpectrum = (nanometers: number): Buffer => {
  const markAt = Math.round(
    ((nanometers - COATING_BOUNDS.min) / (COATING_BOUNDS.max - COATING_BOUNDS.min)) *
      (SIZE - 1),
  );

  return encode(
    draw(SIZE, SIZE, (x, y) => {
      const thickness =
        COATING_BOUNDS.min +
        (x / (SIZE - 1)) * (COATING_BOUNDS.max - COATING_BOUNDS.min);
      const band = coatingColor(thickness);

      // A margin of bare ground top and bottom, so the spectrum reads as a
      // sample of the film rather than as the whole image being the product.
      const inset = y < SIZE * 0.22 || y > SIZE * 0.78;
      const ground: Rgb = { red: 26, green: 26, blue: 30 };
      const marked = Math.abs(x - markAt) <= 2;

      if (marked) return { red: 245, green: 245, blue: 245 };
      if (inset) return ground;

      // Lit from above inside the band, so it reads as a strip of material.
      return mix(band, ground, clamp01(Math.abs(y / SIZE - 0.5) * 0.9));
    }),
  );
};

/**
 * What the coating does to one pigment, across the thickness it is sold at.
 *
 * The diagonal runs from bare paint to the film at its full thickness, so the
 * range of colors this finisher can make of that pigment is the whole image.
 */
export const renderCoatingOver = (baseHex: string, nanometers: number): Buffer => {
  const base = hexToRgb(baseHex);

  return encode(
    draw(SIZE, SIZE, (x, y) => {
      const along = diagonal(x, y);
      const film = coatingColor(nanometers * along);

      // Interference sits on top of the paint rather than replacing it, so the
      // film is added to the base rather than mixed with it.
      return {
        red: base.red + film.red * 0.55 * along,
        green: base.green + film.green * 0.55 * along,
        blue: base.blue + film.blue * 0.55 * along,
      };
    }),
  );
};

/* ------------------------------------------------------------- roughness */

/**
 * A light source reflected in the surface this finisher leaves.
 *
 * The strip is the reflection, and roughness is what happens to it: a
 * lacquered surface returns the source almost intact, and a chalky one
 * scatters it into a wash with no edges. That is the whole difference between
 * gloss and matte, so it is the whole picture.
 */
export const renderSurfaceStrip = (baseHex: string, roughness: number): Buffer => {
  const base = hexToRgb(baseHex);
  const source: Rgb = { red: 255, green: 253, blue: 245 };

  // The band stays the same width; only its edges soften, because a rough
  // surface scatters the same light over a wider angle.
  const spread =
    (roughness - ROUGHNESS_BOUNDS.min) / (ROUGHNESS_BOUNDS.max - ROUGHNESS_BOUNDS.min);
  const radius = Math.round(2 + spread * (SIZE * 0.075));

  const lit = draw(SIZE, SIZE, (x, y) => {
    const along = diagonal(x, y);
    // Darker away from the reflection, so the ground reads as a solid rather
    // than as a flat fill with a stripe on it.
    const ground = mix(base, { red: 0, green: 0, blue: 0 }, 0.35 + along * 0.25);
    const inStrip = Math.abs(along - 0.42) < 0.055;

    return inStrip ? mix(ground, source, 0.85 - spread * 0.35) : ground;
  });

  return encode(blurred(lit, radius));
};

/* ------------------------------------------------------------- emission */

/**
 * A pigment this finisher has made fluoresce, seen in the dark.
 *
 * The circle is the pigment and the wash around it is the light it is giving
 * off, which is the part a photograph of a bright object gets wrong and the
 * part that says how hard it glows. Emission sets how far the wash carries and
 * how far past white the middle goes.
 */
export const renderGlow = (baseHex: string, emission: number): Buffer => {
  const base = hexToRgb(baseHex);
  const strength = clamp01(emission / 100);
  const centre = (SIZE - 1) / 2;
  const core = SIZE * 0.17;
  const reach = core + SIZE * 0.33 * strength;

  const lit = draw(SIZE, SIZE, (x, y) => {
    const distance = Math.hypot(x - centre, y - centre);
    const ground: Rgb = { red: 12, green: 12, blue: 14 };

    if (distance <= core) {
      // Brighter than the pigment, because something making its own light is
      // brighter than the same thing merely lit.
      const gain = 1 + strength * 1.6;
      return { red: base.red * gain, green: base.green * gain, blue: base.blue * gain };
    }

    // Falls away as the square of the distance, the way light does.
    const falloff = clamp01(1 - (distance - core) / (reach - core)) ** 2;

    return {
      red: ground.red + base.red * falloff * strength * 1.3,
      green: ground.green + base.green * falloff * strength * 1.3,
      blue: ground.blue + base.blue * falloff * strength * 1.3,
    };
  });

  // The spill is what a display does when it runs out of range, so it is blur
  // rather than geometry.
  return encode(blurred(lit, Math.round(SIZE * 0.02 + strength * SIZE * 0.03)));
};

/* ---------------------------------------------------------- one finisher's set */

/** One rendered image, and what it shows. */
export type FinishImage = Readonly<{ png: Buffer; alt: string }>;

/**
 * The five pictures a finisher is sold with: the effect, then that effect over each
 * of four ordinary pigments.
 *
 * Which five follows from the one column the finisher has. A finisher sold for a coating
 * leads with the colors its film walks through; one sold for a glow leads with
 * how far that glow carries; one sold for the surface it leaves leads with the
 * reflection left in it. None of them can lead with another's picture, because
 * none of them carries another's number.
 */
export const finisherImages = (
  finisher: Readonly<{ name: string }> & FinishApplication,
): readonly FinishImage[] =>
  match(finisher)
    .with({ applies: "coating" }, ({ name, coatingNanometers }) => [
      {
        png: renderCoatingSpectrum(coatingNanometers),
        alt: `${name}: every color a coating returns as it thickens, with this finisher's ${coatingNanometers} nm marked`,
      },
      ...DEMONSTRATION_COLORS.map(({ name: pigment, hex }) => ({
        png: renderCoatingOver(hex, coatingNanometers),
        alt: `${name} over ${pigment}: bare paint through to the full ${coatingNanometers} nm film`,
      })),
    ])
    .with({ applies: "emission" }, ({ name, emission }) => [
      {
        png: renderGlow(BARE_PIGMENT, emission),
        alt: `${name}: how far the glow it leaves carries, at ${emission}%`,
      },
      ...DEMONSTRATION_COLORS.map(({ name: pigment, hex }) => ({
        png: renderGlow(hex, emission),
        alt: `${name} on ${pigment}: glowing at ${emission}%`,
      })),
    ])
    .with({ applies: "roughness" }, ({ name, roughness }) => [
      {
        png: renderSurfaceStrip(BARE_PIGMENT, roughness),
        alt: `${name}: a reflection in the surface it leaves, at ${roughness}% roughness`,
      },
      ...DEMONSTRATION_COLORS.map(({ name: pigment, hex }) => ({
        png: renderSurfaceStrip(hex, roughness),
        alt: `${name} over ${pigment}: the same surface at ${roughness}% roughness`,
      })),
    ])
    .exhaustive();
