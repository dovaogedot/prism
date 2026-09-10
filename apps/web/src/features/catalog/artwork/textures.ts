/**
 * The grain, without which the slab is not a painted surface.
 *
 * Generated rather than loaded: it is noise, a seeded PRNG makes the same
 * noise every time, and a few kilobytes of `Uint8Array` costs less than a
 * request. It carries no color, so it stays in linear space.
 */

import { DataTexture, RGBAFormat, RepeatWrapping, type Texture } from "three";
import { randomFrom } from "./seeded.ts";

/** One edge of the grain tile, in pixels. */
export const GRAIN_SIZE = 128;

/** The floor of the grain, out of 255. What is above it is the variation. */
export const GRAIN_FLOOR = 214;

/**
 * Fine per-pixel noise, in the two channels that read it: red drives the bump
 * height and green modulates roughness, so a rough face has both a shape and a
 * scatter that vary together.
 *
 * Centered near full so it only ever takes a little off — a roughness map is a
 * multiplier, and noise centered at a half would halve the roughness it is
 * meant to be perturbing.
 */
export const grainPixels = (): Uint8Array => {
  const pixels = new Uint8Array(GRAIN_SIZE * GRAIN_SIZE * 4);
  const random = randomFrom(0x9e3779b9);

  for (let index = 0; index < pixels.length; index += 4) {
    const level = GRAIN_FLOOR + random() * (255 - GRAIN_FLOOR);
    pixels[index] = level;
    pixels[index + 1] = level;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }

  return pixels;
};

/**
 * How many times the grain tiles across the slab.
 *
 * Low, because grain finer than about a pixel stops being texture and starts
 * being the speckle of a render that has not converged.
 */
export const GRAIN_REPEAT = 2;

/** The grain, as the renderer wants it. */
export const grainTexture = (): Texture => {
  const texture = new DataTexture(grainPixels(), GRAIN_SIZE, GRAIN_SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Repeated rather than stretched, which puts the grain below the size of a
  // pixel on a card and just at it on the product page.
  texture.repeat.set(GRAIN_REPEAT, GRAIN_REPEAT);
  texture.needsUpdate = true;

  return texture;
};
