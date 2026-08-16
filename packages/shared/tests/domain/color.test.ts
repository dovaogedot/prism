import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isHexColor,
  parseHex,
  readableInkOn,
  relativeLuminance,
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

describe("contrastRatio", () => {
  it("gives 21:1 for black against white", () => {
    expect(contrastRatio(hex("#000000"), hex("#ffffff"))).toBeCloseTo(21, 5);
  });

  it("gives 1:1 for a color against itself", () => {
    expect(contrastRatio(hex("#3b82f6"), hex("#3b82f6"))).toBeCloseTo(1, 5);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio(hex("#123456"), hex("#fedcba"))).toBeCloseTo(
      contrastRatio(hex("#fedcba"), hex("#123456")),
      10,
    );
  });
});

describe("readableInkOn", () => {
  it("puts dark ink on light swatches", () => {
    expect(readableInkOn(hex("#ffffff"))).toBe("dark");
    expect(readableInkOn(hex("#ffe066"))).toBe("dark");
  });

  it("puts light ink on dark swatches", () => {
    expect(readableInkOn(hex("#000000"))).toBe("light");
    expect(readableInkOn(hex("#1e3a8a"))).toBe("light");
  });

  it("always clears WCAG AA large-text contrast (3:1) for its own choice", () => {
    const swatches = [
      "#ffffff", "#000000", "#ff8800", "#3b82f6", "#facc15",
      "#14532d", "#f5f5f4", "#7f1d1d", "#818cf8", "#a3e635",
    ];

    for (const swatch of swatches) {
      const color = hex(swatch);
      const ink = readableInkOn(color) === "dark" ? hex("#000000") : hex("#ffffff");
      expect(contrastRatio(color, ink)).toBeGreaterThanOrEqual(3);
    }
  });
});
