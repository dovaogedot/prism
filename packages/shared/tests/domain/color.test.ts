import { describe, expect, it } from "vitest";
import {
  isHexColor,
  parseHex,
  relativeLuminance,
  saturationOf,
  toRgb,
  type HexColor,
} from "../../src/domain/color.ts";
import { Option } from "../../src/fp/option.ts";

/** Lifts a literal into the brand for test fixtures; throws on a typo. */
const hex = (value: string): HexColor => {
  if (!isHexColor(value)) throw new Error(`test fixture is not a hex color: ${value}`);
  return value;
};

describe("parseHex", () => {
  it("accepts full six-digit notation", () => {
    expect(parseHex("#ff8800")).toEqual(Option.some("#ff8800"));
  });

  it("expands three-digit shorthand", () => {
    expect(parseHex("#f80")).toEqual(Option.some("#ff8800"));
    expect(parseHex("#fff")).toEqual(Option.some("#ffffff"));
  });

  it("normalizes case so equality is string equality", () => {
    expect(parseHex("#FF8800")).toEqual(parseHex("#ff8800"));
  });

  it("tolerates a missing hash and surrounding whitespace", () => {
    expect(parseHex("  ff8800 ")).toEqual(Option.some("#ff8800"));
  });

  it("rejects malformed input rather than guessing", () => {
    const rejected = [
      "",
      "#",
      "#ff",
      "#ff880",
      "#ff88000",
      "#gggggg",
      "rgb(255,136,0)",
      "#ff 88 00",
      "javascript:alert(1)",
    ];

    for (const input of rejected) {
      expect(parseHex(input)).toEqual(Option.none);
    }
  });
});

describe("toRgb", () => {
  it("splits the channels", () => {
    expect(toRgb(hex("#ff8800"))).toEqual({ red: 255, green: 136, blue: 0 });
    expect(toRgb(hex("#000000"))).toEqual({ red: 0, green: 0, blue: 0 });
    expect(toRgb(hex("#ffffff"))).toEqual({ red: 255, green: 255, blue: 255 });
  });
});

describe("saturationOf", () => {
  it("calls a gray unsaturated whatever its lightness", () => {
    for (const gray of ["#000000", "#808080", "#ffffff", "#3b3b3b"]) {
      expect(saturationOf(toRgb(hex(gray))), gray).toBe(0);
    }
  });

  it("calls a pure hue fully saturated whatever its lightness", () => {
    // The HSL definition, where saturation is chroma relative to the most a
    // color of that lightness could have — so a pale pink is as saturated as
    // the red it was mixed from.
    for (const pure of ["#ff0000", "#00ff00", "#0000ff", "#ffcccc", "#330000"]) {
      expect(saturationOf(toRgb(hex(pure))), pure).toBe(100);
    }
  });

  it("agrees with the database, which derives the same number from the hex", () => {
    // Values checked against the database's `hex_to_saturation`. A drift
    // here is a color the seed judges fit to fluoresce and Postgres does not.
    expect(saturationOf(toRgb(hex("#d8c8a8")))).toBe(38);
    expect(saturationOf(toRgb(hex("#4a7c40")))).toBe(32);
    expect(saturationOf(toRgb(hex("#6a2d8f")))).toBe(52);
    expect(saturationOf(toRgb(hex("#e4dfd8")))).toBe(18);
  });
});

describe("relativeLuminance", () => {
  it("anchors black at 0 and white at 1", () => {
    expect(relativeLuminance(toRgb(hex("#000000")))).toBeCloseTo(0, 5);
    expect(relativeLuminance(toRgb(hex("#ffffff")))).toBeCloseTo(1, 5);
  });

  it("weights green above red above blue, per the sRGB coefficients", () => {
    const red = relativeLuminance(toRgb(hex("#ff0000")));
    const green = relativeLuminance(toRgb(hex("#00ff00")));
    const blue = relativeLuminance(toRgb(hex("#0000ff")));

    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(red).toBeCloseTo(0.2126, 4);
    expect(green).toBeCloseTo(0.7152, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
  });

  it("applies the low-end linear segment below the 0.04045 knee", () => {
    // #050505 sits under the knee, where the curve is linear rather than gamma.
    expect(relativeLuminance(toRgb(hex("#050505")))).toBeCloseTo(0.001518, 5);
  });
});

