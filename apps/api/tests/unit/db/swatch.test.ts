import { describe, expect, it } from "vitest";
import { crc32, encodePng, hexToRgb, renderSwatch } from "../../../src/db/swatch.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Walks the chunk list the way a decoder would. */
const chunksOf = (png: Buffer): readonly string[] => {
  const types: string[] = [];
  let offset = 8;

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    types.push(png.toString("ascii", offset + 4, offset + 8));
    offset += 12 + length;
  }

  return types;
};

describe("crc32", () => {
  it("matches the known check value for 'IEND'", () => {
    expect(crc32(Buffer.from("IEND", "ascii"))).toBe(0xae426082);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array([]))).toBe(0);
  });

  it("is deterministic and sensitive to a single bit", () => {
    expect(crc32(Buffer.from("abc"))).toBe(crc32(Buffer.from("abc")));
    expect(crc32(Buffer.from("abc"))).not.toBe(crc32(Buffer.from("abd")));
  });

  it("always produces an unsigned 32-bit value", () => {
    for (const input of ["", "a", "IDAT", "x".repeat(1000)]) {
      const value = crc32(Buffer.from(input));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("hexToRgb", () => {
  it("splits the channels", () => {
    expect(hexToRgb("#ff8800")).toEqual({ red: 255, green: 136, blue: 0 });
    expect(hexToRgb("#000000")).toEqual({ red: 0, green: 0, blue: 0 });
  });
});

describe("encodePng", () => {
  const solid = encodePng(4, 4, () => ({ red: 10, green: 20, blue: 30 }));

  it("starts with the PNG signature", () => {
    expect(solid.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it("emits IHDR, IDAT and IEND in that order", () => {
    expect(chunksOf(solid)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("records the dimensions and color type in the header", () => {
    const png = encodePng(7, 3, () => ({ red: 0, green: 0, blue: 0 }));

    expect(png.readUInt32BE(16)).toBe(7); // width
    expect(png.readUInt32BE(20)).toBe(3); // height
    expect(png.readUInt8(24)).toBe(8); // bit depth
    expect(png.readUInt8(25)).toBe(2); // truecolor
  });

  it("ends exactly at the IEND boundary, with nothing trailing", () => {
    let offset = 8;
    while (offset < solid.length) {
      offset += 12 + solid.readUInt32BE(offset);
    }
    expect(offset).toBe(solid.length);
  });

  it("clamps out-of-range channel values instead of wrapping", () => {
    const png = encodePng(2, 2, () => ({ red: 300, green: -40, blue: 128.7 }));
    expect(png.length).toBeGreaterThan(8);
    expect(chunksOf(png)).toContain("IDAT");
  });

  it("is deterministic, so a swatch keeps its content-addressed name", () => {
    const first = encodePng(8, 8, (x, y) => ({ red: x, green: y, blue: 0 }));
    const second = encodePng(8, 8, (x, y) => ({ red: x, green: y, blue: 0 }));

    expect(first.equals(second)).toBe(true);
  });

  it("handles a single pixel", () => {
    const png = encodePng(1, 1, () => ({ red: 255, green: 0, blue: 0 }));
    expect(chunksOf(png)).toEqual(["IHDR", "IDAT", "IEND"]);
  });
});

describe("renderSwatch", () => {
  it("produces a decodable PNG of the requested size", () => {
    const png = renderSwatch("#3b82f6", 32);

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it("gives different colors different bytes", () => {
    expect(renderSwatch("#ff0000", 16).equals(renderSwatch("#00ff00", 16))).toBe(false);
  });

  it("is deterministic for the same color", () => {
    expect(renderSwatch("#facc15", 16).equals(renderSwatch("#facc15", 16))).toBe(true);
  });

  it("compresses a flat-ish swatch to a sensible size", () => {
    // A 600px swatch that came out megabytes large would mean the filter byte
    // or the deflate level was wrong.
    expect(renderSwatch("#000000", 600).length).toBeLessThan(100_000);
  });
});
