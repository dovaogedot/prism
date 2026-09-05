/**
 * Three amounts becoming a material.
 *
 * The numbers themselves are tuned by eye and will move. What must not move is
 * that every one of them is a continuous function of its input: there must be
 * no band anywhere in here for a color to fall on the wrong side of, or two
 * colors a point apart render as different kinds of thing and a filter that
 * returns them both shows two pictures that disagree.
 */

import { describe, expect, it } from "vitest";
import {
  COATING_BOUNDS,
  EMISSION_BOUNDS,
  MATTE_FLOOR,
  relativeLuminance,
  ROUGHNESS_BOUNDS,
} from "@prism/shared";
import {
  emissiveScale,
  excite,
  surfaceFor,
  type Finishing,
} from "../src/features/catalog/artwork/surfaces.ts";

/** The three amounts, with the two a case does not care about at zero. */
const made = (
  roughness: number,
  coatingNanometers = 0,
  emission = 0,
): Finishing => ({ roughness, coatingNanometers, emission });

const LACQUERED = made(ROUGHNESS_BOUNDS.min);
const CHALK = made(ROUGHNESS_BOUNDS.max);

describe("surfaceFor", () => {
  it("scatters more the rougher the color is", () => {
    expect(surfaceFor(CHALK).roughness).toBeGreaterThan(
      surfaceFor(LACQUERED).roughness,
    );
  });

  it("never reaches a perfect mirror or perfect chalk", () => {
    // Both ends of the stored range are still paint, and paint that returned
    // everything or nothing would not be paint.
    expect(surfaceFor(LACQUERED).roughness).toBeGreaterThan(0);
    expect(surfaceFor(CHALK).roughness).toBeLessThan(1);
  });

  it("thins the lacquer as the pigment coarsens, and takes it off at matte", () => {
    // Which is the whole of what "gloss" was: the sharp reflection comes off a
    // coat, and a chalky surface has no coat to give one.
    expect(surfaceFor(LACQUERED).clearcoat).toBeGreaterThan(0.9);
    expect(surfaceFor(made(MATTE_FLOOR)).clearcoat).toBe(0);
    expect(surfaceFor(CHALK).clearcoat).toBe(0);
    expect(surfaceFor(made(30)).clearcoat).toBeGreaterThan(
      surfaceFor(made(60)).clearcoat,
    );
  });

  it("gives the rough end a sheen and the smooth end none", () => {
    expect(surfaceFor(CHALK).sheen).toBeGreaterThan(0);
    expect(surfaceFor(LACQUERED).sheen).toBe(0);
  });

  it("turns the coating on only where there is one", () => {
    // Bare paint leaves a trace rather than a zero, which keeps the shader
    // feature compiled in and draws nothing.
    expect(surfaceFor(made(20, COATING_BOUNDS.min)).iridescence).toBe(1);
    expect(surfaceFor(made(50, 0)).iridescence).toBeLessThan(0.01);
    expect(surfaceFor(made(50, 0)).iridescence).toBeGreaterThan(0);
  });

  it("carries the coating's thickness through as it was stored", () => {
    // The thickness is the fact. Nothing between the column and the shader is
    // allowed to scale it, because it is what decides the color.
    for (const thickness of [COATING_BOUNDS.min, 240, COATING_BOUNDS.max]) {
      expect(surfaceFor(made(20, thickness)).coatingNanometers).toBe(thickness);
    }
  });

  it("takes the lacquer and the grain off a coated surface", () => {
    // The coating is the top layer and it levels what it is poured over, so
    // there is no second reflection over it and no paint texture through it.
    const coated = surfaceFor(made(20, 300));

    expect(coated.clearcoat).toBe(0);
    expect(coated.relief).toBe(0);
    expect(surfaceFor(made(20, 0)).relief).toBeGreaterThan(0);
  });

  it("keeps a glowing face lit and adds to what it returns", () => {
    // Fluorescence is absorption and re-emission, not a light source pretending
    // to be paint: the surface still takes the room's light and still has the
    // shading and the highlight that come with it.
    const glowing = surfaceFor(made(50, 0, 80));
    const dark = surfaceFor(made(50, 0, 0));

    expect(glowing.emission).toBeGreaterThan(0);
    expect(dark.emission).toBe(0);
    expect(glowing.envIntensity).toBe(dark.envIntensity);
    expect(glowing.roughness).toBe(dark.roughness);
  });

  it("gives back more of its own band the harder it glows", () => {
    const faint = surfaceFor(made(50, 0, 40));
    const fierce = surfaceFor(made(50, 0, 100));

    expect(fierce.emission).toBeGreaterThan(faint.emission);
    expect(fierce.bloom.strength).toBeGreaterThan(faint.bloom.strength);
  });

  it("keeps the glow to what a surface can plausibly hand back", () => {
    // More than the lamp gave it, which is what makes a fluorescent one — but
    // within an order of it, or the face stops being a surface and becomes a
    // shape cut out of white.
    expect(surfaceFor(made(50, 0, EMISSION_BOUNDS.max)).emission).toBeLessThan(1);
  });

  it("is proportional in the amount, so the number means something", () => {
    const half = surfaceFor(made(50, 0, EMISSION_BOUNDS.max / 2)).emission;
    const full = surfaceFor(made(50, 0, EMISSION_BOUNDS.max)).emission;

    expect(full).toBeCloseTo(2 * half);
  });


  it("returns more of the room the more lacquer is over the pigment", () => {
    expect(surfaceFor(LACQUERED).envIntensity).toBeGreaterThan(
      surfaceFor(CHALK).envIntensity,
    );
  });

  it("shows more texture the rougher the surface", () => {
    expect(surfaceFor(CHALK).relief).toBeGreaterThan(surfaceFor(LACQUERED).relief);
  });

  it("spills off a lacquer and off a glow, and off nothing else", () => {
    const dull = made(MATTE_FLOOR, 0, 0);

    expect(surfaceFor(dull).bloom.strength).toBe(0);
    expect(surfaceFor(LACQUERED).bloom.strength).toBeGreaterThan(0);
    expect(
      surfaceFor(made(MATTE_FLOOR, 0, EMISSION_BOUNDS.max)).bloom.strength,
    ).toBeGreaterThan(0);
  });

  it("spills only off pixels brighter than lit paint can get", () => {
    // Paint tops out at about the light that fell on it. A threshold under one
    // blooms the paint itself, and worse, it makes a cliff between two colors
    // that differ by a point.
    for (const roughness of [ROUGHNESS_BOUNDS.min, 40, ROUGHNESS_BOUNDS.max]) {
      expect(surfaceFor(made(roughness, 0, 80)).bloom.threshold).toBeGreaterThan(1);
    }
  });

  it("moves by a hair for a color that differs by a point", () => {
    // The property this file exists to hold down. Anything with a band in it
    // fails here.
    for (let roughness = ROUGHNESS_BOUNDS.min; roughness < ROUGHNESS_BOUNDS.max; roughness += 1) {
      const here = surfaceFor(made(roughness));
      const next = surfaceFor(made(roughness + 1));

      expect(Math.abs(next.roughness - here.roughness)).toBeLessThan(0.05);
      expect(Math.abs(next.clearcoat - here.clearcoat)).toBeLessThan(0.05);
      expect(Math.abs(next.sheen - here.sheen)).toBeLessThan(0.05);
      expect(Math.abs(next.envIntensity - here.envIntensity)).toBeLessThan(0.05);
    }
  });

  it("keeps every parameter inside the range it is defined on", () => {
    for (const roughness of [ROUGHNESS_BOUNDS.min, 44, ROUGHNESS_BOUNDS.max]) {
      for (const coating of [0, COATING_BOUNDS.min, COATING_BOUNDS.max]) {
        for (const emission of [0, 50, EMISSION_BOUNDS.max]) {
          const surface = surfaceFor(made(roughness, coating, emission));


          for (const unit of [
            surface.roughness,
            surface.metalness,
            surface.sheen,
            surface.clearcoat,
            surface.clearcoatRoughness,
            surface.iridescence,
          ]) {
            expect(unit).toBeGreaterThanOrEqual(0);
            expect(unit).toBeLessThanOrEqual(1);
          }

          expect(surface.bloom.strength).toBeGreaterThanOrEqual(0);
          expect(surface.relief).toBeGreaterThanOrEqual(0);
          expect(surface.emission).toBeGreaterThanOrEqual(0);
          // Every face returns some of the room, glowing or not — a surface
          // that returned none of it would not read as a surface.
          expect(surface.envIntensity).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("excite", () => {
  it("pushes the color up to the top of its own band", () => {
    expect(excite({ red: 14, green: 22, blue: 103 })).toEqual({
      red: 14 * (255 / 103),
      green: 22 * (255 / 103),
      blue: 255,
    });
  });

  it("keeps the hue it was given", () => {
    const glow = excite({ red: 30, green: 60, blue: 90 });

    expect(glow.green / glow.red).toBeCloseTo(2);
    expect(glow.blue / glow.red).toBeCloseTo(3);
  });

  it("leaves a color that is already at full alone", () => {
    expect(excite({ red: 255, green: 128, blue: 0 })).toEqual({
      red: 255,
      green: 128,
      blue: 0,
    });
  });

  it("does not invent a band for a color that has none", () => {
    expect(excite({ red: 0, green: 0, blue: 0 })).toEqual({
      red: 0,
      green: 0,
      blue: 0,
    });
  });
});

describe("emissiveScale", () => {
  /** A saturated yellow and a saturated violet, both at the top of their band. */
  const YELLOW = { red: 247, green: 255, blue: 38 };
  const VIOLET = { red: 159, green: 82, blue: 255 };

  it("asks more of a dim color than of a bright one for the same light", () => {
    // The point of the whole function: a violet carries far less luminance per
    // unit of color than a yellow, so it needs more of itself to look as
    // bright — and "emission 60" has to mean the same thing on both.
    expect(emissiveScale(0.4, VIOLET)).toBeGreaterThan(emissiveScale(0.4, YELLOW));
  });

  it("hands back the amount of light it was asked for", () => {
    for (const band of [YELLOW, VIOLET]) {
      const emitted = emissiveScale(0.4, band) * relativeLuminance(band);

      expect(emitted).toBeCloseTo(0.4);
    }
  });

  it("is proportional in the amount", () => {
    expect(emissiveScale(0.6, VIOLET)).toBeCloseTo(2 * emissiveScale(0.3, VIOLET));
  });

  it("gives off nothing for a color with no light in it", () => {
    expect(emissiveScale(1, { red: 0, green: 0, blue: 0 })).toBe(0);
  });
});
