import { describe, expect, it } from "vitest";
import { Raster, type Raw, type Rgba } from "../../../scripts/catalog/raster.ts";

/** An image from rows of characters: `.` is transparent, `w` white, `k` black, `h` a half-clear white. */
const image = (rows: readonly string[]): Raw => {
  const width = rows[0]?.length ?? 0;
  const data = Buffer.alloc(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      const color = { ".": [0, 0, 0, 0], w: [255, 255, 255, 255], k: [0, 0, 0, 255], h: [255, 255, 255, 100] }[cell] ?? [0, 0, 0, 0];
      data.set(color, (y * width + x) * 4);
    }),
  );
  return { data, width, height: rows.length };
};

const rows = (raw: Raw): string[] =>
  Array.from({ length: raw.height }, (_, y) =>
    Array.from({ length: raw.width }, (_, x) => {
      const { r, a } = Raster.pixel(raw, x, y);
      return a === 0 ? "." : a < 0.5 ? "h" : r === 1 ? "w" : "k";
    }).join(""),
  );

describe("Raster.bounds and margin", () => {
  it("boxes the content, leaving out a faint halo", () => {
    const raw = image(["....", ".hk.", "..k.", "...."]);
    expect(Raster.bounds(raw)).toEqual({ left: 2, top: 1, width: 1, height: 2 });
    expect(Raster.margin(raw)).toBe(1);
  });

  it("takes the whole image when nothing is solid", () => {
    expect(Raster.bounds(image(["..", ".."]))).toEqual({ left: 0, top: 0, width: 2, height: 2 });
    expect(Raster.margin(image(["kk", "kk"]))).toBe(0);
  });
});

describe("Raster.cropped", () => {
  it("keeps the pixels inside the box", () => {
    expect(rows(Raster.cropped(image(["wk..", "kw..", "...."]), { left: 1, top: 0, width: 2, height: 2 }))).toEqual(["k.", "w."]);
  });
});

describe("Raster.faced", () => {
  const ink = (color: Rgba): boolean => color.a > 0 && color.r < 1;

  const face = image(["hhhhh", "hhhhh", "hhhhh", "hhhhh", "hhhhh"]);

  it("draws the ink and what it encloses, centered on the face", () => {
    expect(rows(Raster.faced(face, image(["kkk", "kwk", "kkk"]), ink))).toEqual(["hhhhh", "hkkkh", "hkwkh", "hkkkh", "hhhhh"]);
  });

  it("shows the face through what reaches the card's edge without ink", () => {
    expect(rows(Raster.faced(face, image(["www", "kwk", "kkk"]), ink))).toEqual(["hhhhh", "hhhhh", "hkhkh", "hkkkh", "hhhhh"]);
  });

  it("shows only the face when nothing is ink", () => {
    expect(rows(Raster.faced(image(["hh", "hh"]), image(["kk", "kk"]), () => false))).toEqual(["hh", "hh"]);
  });
});

describe("Raster.shaded", () => {
  it("hands each pixel its center and color, and clips the result to bytes", () => {
    const seen: number[][] = [];
    const shaded = Raster.shaded(image(["wk"]), ({ x, y }, color) => {
      seen.push([x, y, color.r]);
      return { r: 2, g: -1, b: color.r, a: 1 };
    });
    expect(seen).toEqual([[0.25, 0.5, 1], [0.75, 0.5, 0]]);
    expect(Raster.pixel(shaded, 0, 0)).toEqual({ r: 1, g: 0, b: 1, a: 1 });
    expect(Raster.pixel(shaded, 1, 0)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});
