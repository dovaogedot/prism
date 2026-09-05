/**
 * What a color is made of, in the terms a physical renderer understands.
 *
 * A function rather than a table, because a color carries three amounts and
 * not a name: the three go in and every parameter the material needs comes
 * out. Nothing that draws the scene branches on a finish, which is what stops
 * the picture disagreeing with what the thing is sold as.
 */

import {
  EMISSION_BOUNDS,
  MATTE_FLOOR,
  relativeLuminance,
  ROUGHNESS_BOUNDS,
  type Rgb,
} from "@prism/shared";

/** The stored amounts, as the renderer receives them. */
export type Finishing = Readonly<{
  /** 5 is a mirror, 95 is chalk. */
  roughness: number;
  /** Nanometers of interference coating. Zero is bare paint. */
  coatingNanometers: number;
  /** How hard the pigment gives off its own light, out of 100. */
  emission: number;
}>;

/** How light spills off a surface. */
export type Bloom = Readonly<{
  /** How far a pixel over the threshold spills. Zero skips the pass entirely. */
  strength: number;
  /** How bright a pixel has to be, in linear light, before it spills at all. */
  threshold: number;
}>;

/** Everything one material needs, all of it a physical quantity. */
export type Surface = Readonly<{
  /** How scattered the pigment's own reflection is, from 0 to 1. */
  roughness: number;
  /** How much the pigment behaves like metal, which tints its reflection. */
  metalness: number;
  /** A soft retroreflective lobe over the pigment, the way chalk has one. */
  sheen: number;
  /** A lacquer over the pigment, with a second reflection of its own. */
  clearcoat: number;
  /** How scattered that lacquer's reflection is. */
  clearcoatRoughness: number;
  /** Strength of the thin-film interference, from 0 to 1. */
  iridescence: number;
  /** Thickness of the coating, in nanometers. One layer, one thickness. */
  coatingNanometers: number;
  /**
   * How much light the face gives off on top of the light it returns, as
   * luminance — 1 being as much again as a white surface under the same lamp.
   *
   * Fluorescence is absorption and re-emission, so a pigment that fluoresces
   * is an ordinary lit surface that also adds: it keeps its shading, its
   * highlight and its edges, and its own band comes back stronger than it
   * went in. Zero for a pigment that only reflects.
   *
   * Luminance and not radiance, because "how hard it glows" is a claim about
   * brightness: a violet and a yellow sold with the same number have to look
   * equally bright, and they carry very different amounts of energy to do it.
   */
  emission: number;
  /** How much of the room the face returns. */
  envIntensity: number;
  /** Height of the micro-texture, in slab widths. Roughness you can see. */
  relief: number;
  /** What the bloom pass makes of this surface. */
  bloom: Bloom;
}>;

/* ------------------------------------------------------------ the coating */

/**
 * Refractive index of the coating, which is titanium dioxide.
 *
 * Every interference pigment ever sold is built the same way: a flake of
 * something transparent with a layer of titanium dioxide grown on it. The
 * material is chosen for exactly this number — light entering a layer of index
 * 2.4 from air, over paint of about 1.5, is turned back at both faces of the
 * layer strongly enough for the two returns to interfere. A layer whose index
 * matched the paint under it would be no layer at all: nothing would come back
 * off the second face to interfere with.
 *
 * Fixed, because it is a property of the material rather than of how much of
 * it a color carries.
 */
export const COATING_IOR = 2.4;

/* ------------------------------------------------------------ the surface */

/** Where a color's roughness sits between the two ends of its range, 0 to 1. */
const roughnessFraction = (roughness: number): number => {
  const span = ROUGHNESS_BOUNDS.max - ROUGHNESS_BOUNDS.min;

  return Math.max(0, Math.min(1, (roughness - ROUGHNESS_BOUNDS.min) / span));
};

/** Nothing is ever a perfect mirror, and nothing is ever perfectly chalk. */
const PBR_ROUGHNESS = { smoothest: 0.09, roughest: 0.92 } as const;

/** The lacquer thins out as the pigment under it coarsens, and stops at chalk. */
const lacquerOver = (roughness: number): number =>
  Math.max(0, (MATTE_FLOOR - roughness) / (MATTE_FLOOR - ROUGHNESS_BOUNDS.min));

/** Chalk has a sheen; a mirror has none. Nothing below halfway has any. */
const SHEEN_FROM = 45;

/**
 * What a pigment glowing as hard as pigment glows adds to the light it returns.
 *
 * A fluorescent surface returns more in its own band than fell on it, because
 * the energy it absorbed further up the spectrum comes back down there. This
 * is how much more, at the top of the range — enough to carry a face past what
 * a lamp alone can do to it, which is what makes one look lit from inside.
 */
const EMISSION_GAIN = 0.45;

/** Bloom sits above what lit paint reaches, so only a reflection ever spills. */
const BLOOM_THRESHOLD = 1.15;

/**
 * The material for one color.
 *
 * Pure, and the only place the three stored amounts become rendering
 * parameters. Everything it returns is a continuous function of its input, so
 * two colors a point apart render a point apart — there is no band anywhere in
 * here for a color to fall on the wrong side of.
 */
export const surfaceFor = (finishing: Finishing): Surface => {
  const rough = roughnessFraction(finishing.roughness);
  const lacquer = lacquerOver(finishing.roughness);
  const glow = Math.max(0, Math.min(1, finishing.emission / EMISSION_BOUNDS.max));
  const coated = finishing.coatingNanometers > 0;

  return {
    roughness:
      PBR_ROUGHNESS.smoothest +
      rough * (PBR_ROUGHNESS.roughest - PBR_ROUGHNESS.smoothest),
    // A coating is a dielectric. Tinting its reflection by the pigment, which
    // is what metalness does, would put the paint's color on top of the
    // interference and bury it.
    metalness: 0,
    sheen: Math.max(
      0,
      (finishing.roughness - SHEEN_FROM) / (ROUGHNESS_BOUNDS.max - SHEEN_FROM),
    ),
    // No lacquer over a coating. The coating is already the top layer, and a
    // second reflection over it is a mirror of the strip lamp laid across the
    // interference — glare rather than a finish.
    clearcoat: coated ? 0 : lacquer,
    clearcoatRoughness: 0.07 + rough * 0.1,
    // Never quite zero. The shader feature is compiled in or out by whether
    // this is above zero, and one material serving every color on the page
    // cannot afford to be recompiled between two of them.
    iridescence: coated ? 1 : 0.0001,
    coatingNanometers: finishing.coatingNanometers,
    emission: glow * EMISSION_GAIN,
    // A rough face returns less of the room, and a lacquered one returns the
    // most of anything because the coat is a mirror. A glowing face returns
    // the room too — what it gives off is added to that rather than replacing
    // it, which is the difference between a lit object and a flat shape.
    envIntensity: coated ? 1 : 0.55 + lacquer * 0.65,
    // A coating is a poured layer and levels what it is poured over, so the
    // grain of the paint stops at the point the coating starts.
    relief: coated ? 0 : rough * 0.0035,
    bloom: {
      // Two things spill: a lacquer, which returns the strip hot enough to
      // clip, and a pigment giving off its own light. Both are small on
      // purpose — a spill is the display admitting it has run out of range,
      // and one big enough to reach the wall says instead that the room is
      // that color. `catalog-artwork.spec.ts` holds the ceiling down.
      strength: (coated ? 0 : lacquer * 0.03) + glow * 0.028,
      threshold: BLOOM_THRESHOLD,
    },
  };
};

/* ---------------------------------------------------------------- the glow */

/**
 * The scalar a material needs on an emissive color for the face to give off a
 * wanted amount of light.
 *
 * The material multiplies a color by a number, so the number that produces a
 * given brightness depends on how bright the color already is. A saturated
 * yellow is four times the luminance of a saturated violet, and dividing by
 * that is the whole of what makes an emission of 60 mean the same brightness
 * on both — without it the number is legible on the top half of the wheel and
 * does nothing on the bottom.
 *
 * `band` is the color being emitted, in sRGB. A color with no light in it at
 * all gives off none however hard it is asked to.
 */
export const emissiveScale = (emission: number, band: Rgb): number => {
  const luminance = relativeLuminance(band);

  return luminance <= 0 ? 0 : emission / luminance;
};

/**
 * A color at the top of its own band: the hue it was given, as bright as that
 * hue goes.
 *
 * What a fluorescent pigment both reflects and re-emits. Fluorescence happens
 * in a narrow band and returns nearly all of it, so such a pigment is never
 * dark — it is its hue at full strength, which is the color this returns. A
 * color with no channel at all has no band to return, and stays where it is.
 */
export const excite = (rgb: Rgb): Rgb => {
  const peak = Math.max(rgb.red, rgb.green, rgb.blue);

  if (peak === 0) return rgb;

  const gain = 255 / peak;

  // The channel the gain came from is set rather than scaled: reaching 255 is
  // the definition of the gain, and floating point lands a hair under it —
  // which leaves the glow imperceptibly short of the color it is a glow of.
  const lift = (channel: number): number => (channel === peak ? 255 : channel * gain);

  return { red: lift(rgb.red), green: lift(rgb.green), blue: lift(rgb.blue) };
};
