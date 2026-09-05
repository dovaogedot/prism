/**
 * The generated textures.
 *
 * Two properties matter, and both are about the picture being the same picture
 * every time: the noise is seeded rather than random, and the grain's speckle
 * wraps, because a slab whose face has a seam down it is a slab with a mistake
 * on it.
 *
 * These are the bytes only. Handing them to a `DataTexture` is three lines of
 * renderer glue with nothing in it to be wrong.
 */

import { describe, expect, it } from "vitest";
import {
  GRAIN_FLOOR,
  GRAIN_SIZE,
  grainPixels,
} from "../src/features/catalog/artwork/textures.ts";

describe("grainPixels", () => {
  it("makes the same grain every time", () => {
    expect(grainPixels()).toEqual(grainPixels());
  });

  it("fills the tile it says it fills", () => {
    expect(grainPixels()).toHaveLength(GRAIN_SIZE * GRAIN_SIZE * 4);
  });

  it("varies, which is the entire job", () => {
    const pixels = grainPixels();
    const levels = new Set<number>();

    for (let index = 0; index < pixels.length; index += 4) levels.add(pixels[index] ?? 0);

    expect(levels.size).toBeGreaterThan(32);
  });

  it("only ever takes a little off the roughness it multiplies", () => {
    // A roughness map is a multiplier. Noise centered on a half would halve the
    // roughness of every finish rather than perturb it.
    const pixels = grainPixels();

    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels[index]).toBeGreaterThanOrEqual(GRAIN_FLOOR);
    }
  });

  it("says the same thing in both channels that are read", () => {
    // Red is the bump height and green is the roughness; a rough patch that
    // was not also a raised patch would shade in a direction it has no shape
    // for.
    const pixels = grainPixels();

    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels[index + 1]).toBe(pixels[index]);
    }
  });
});
