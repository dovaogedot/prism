/**
 * The pictures a finisher is sold with are rendered from one number, so what these
 * pin is that the number and the picture cannot come apart: the physics is the
 * physics the storefront's own renderer uses, the disc really is radial, and
 * the ring marking a finisher's thickness lands on the color that thickness makes.
 */

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { COATING_BOUNDS } from "@prism/shared";
import {
  coatingColor,
  renderCoatingSpectrum,
  spectrumRadiusOf,
  spectrumThicknessAt,
} from "../../../src/db/finish-art.ts";
import type { Rgb } from "../../../src/db/swatch.ts";

/** Every whole nanometer a coating is sold at. */
const SOLD_AT = Array.from(
  { length: COATING_BOUNDS.max - COATING_BOUNDS.min + 1 },
  (_, offset) => COATING_BOUNDS.min + offset,
);

/**
 * The pixels of a PNG this codebase wrote.
 *
 * Only that: truecolor, eight bits, one IDAT and filter 0 on every scanline,
 * which is what `encodePng` emits and all this has to read.
 */
const decode = (
  png: Buffer,
): Readonly<{ width: number; height: number; at: (x: number, y: number) => Rgb }> => {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  let offset = 8;
  let pixels = Buffer.alloc(0);

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      pixels = inflateSync(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }

  const stride = 1 + width * 3;

  return {
    width,
    height,
    at: (x, y) => {
      const start = y * stride + 1 + x * 3;

      return {
        red: pixels[start] ?? 0,
        green: pixels[start + 1] ?? 0,
        blue: pixels[start + 2] ?? 0,
      };
    },
  };
};

describe("coatingColor", () => {
  it("returns black for no film, which is no color rather than a dark one", () => {
    expect(coatingColor(0)).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it("peaks a channel where the two reflections come back a half wave apart", () => {
    // 2·n·d = λ/2 puts them exactly out of step, and the flip at the top
    // surface puts them back in, so that channel returns everything it can.
    const red = coatingColor(610 / (4 * 2.4));

    expect(red.red).toBeCloseTo(255, 6);
  });

  it("cancels a channel where they come back a whole wave apart", () => {
    const red = coatingColor(610 / (2 * 2.4));

    expect(red.red).toBeCloseTo(0, 6);
  });

  it("stays inside the eight bits it will be written to", () => {
    for (const nanometers of SOLD_AT) {
      const film = coatingColor(nanometers);

      for (const channel of [film.red, film.green, film.blue]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it("moves smoothly, so no thickness is a step away from its neighbor", () => {
    // A jump here would be a place where two finishers a nanometer apart are sold
    // with pictures that disagree about what a coating does. The measured
    // worst case across the range is 8.4 of 255.
    for (const nanometers of SOLD_AT.slice(0, -1)) {
      const here = coatingColor(nanometers);
      const next = coatingColor(nanometers + 1);

      expect(Math.abs(next.red - here.red)).toBeLessThan(9);
      expect(Math.abs(next.green - here.green)).toBeLessThan(9);
      expect(Math.abs(next.blue - here.blue)).toBeLessThan(9);
    }
  });
});

describe("the spectrum disc's radius", () => {
  it("puts every thickness back where it came from", () => {
    for (const nanometers of SOLD_AT) {
      expect(spectrumThicknessAt(spectrumRadiusOf(nanometers))).toBeCloseTo(
        nanometers,
        9,
      );
    }
  });

  it("runs outward, thin to thick", () => {
    for (const nanometers of SOLD_AT.slice(0, -1)) {
      expect(spectrumRadiusOf(nanometers + 1)).toBeGreaterThan(
        spectrumRadiusOf(nanometers),
      );
    }
  });

  it("gives the thinnest film a ring rather than a point", () => {
    // A finisher at the bottom of the range has to be marked by something a reader
    // can see, and a circle of radius zero is not that.
    expect(spectrumRadiusOf(COATING_BOUNDS.min)).toBeGreaterThan(8);
  });

  it("holds the ends of the range past the ends of the sweep", () => {
    expect(spectrumThicknessAt(0)).toBe(COATING_BOUNDS.min);
    expect(spectrumThicknessAt(spectrumRadiusOf(COATING_BOUNDS.max) + 50)).toBe(
      COATING_BOUNDS.max,
    );
  });
});

describe("renderCoatingSpectrum", () => {
  const image = decode(renderCoatingSpectrum(320));

  it("is square, and as wide as every other picture in a finisher's set", () => {
    expect(image.width).toBe(600);
    expect(image.height).toBe(image.width);
  });

  it("depends on distance from the center and nothing else", () => {
    // The whole of what makes it radial: a point and its reflections through
    // both axes and the diagonal are the same distance out, so they are the
    // same color. Anything left of the old left-to-right sweep would fail it.
    const last = image.width - 1;

    for (const [x, y] of [
      [140, 210],
      [299, 40],
      [61, 300],
      [230, 230],
    ] as const) {
      const here = image.at(x, y);

      expect(image.at(last - x, y)).toEqual(here);
      expect(image.at(x, last - y)).toEqual(here);
      expect(image.at(last - x, last - y)).toEqual(here);
      expect(image.at(y, x)).toEqual(here);
    }
  });

  it("marks the finisher's own thickness, at both ends of the range", () => {
    // The mark is the one thing on the disc no film returns, so finding it is
    // finding a pixel brighter and flatter than interference ever is.
    const marked = (nanometers: number): boolean => {
      const drawn = decode(renderCoatingSpectrum(nanometers));
      const center = (drawn.width - 1) / 2;
      const radius = spectrumRadiusOf(nanometers);
      const pixel = drawn.at(Math.round(center + radius), Math.round(center));

      return pixel.red > 230 && pixel.green > 230 && pixel.blue > 230;
    };

    expect(marked(COATING_BOUNDS.min)).toBe(true);
    expect(marked(COATING_BOUNDS.max)).toBe(true);
    expect(marked(320)).toBe(true);
  });

  it("puts the mark somewhere different for every thickness", () => {
    const middle = (drawn: ReturnType<typeof decode>): readonly number[] =>
      Array.from({ length: drawn.width }, (_, x) => drawn.at(x, 299).red);

    expect(middle(decode(renderCoatingSpectrum(180)))).not.toEqual(
      middle(decode(renderCoatingSpectrum(420))),
    );
  });
});
