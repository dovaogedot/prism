import { describe, expect, it } from "vitest";
import { createRandom, hslToHex, mulberry32, slugify } from "./palette.ts";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const first = Array.from({ length: 10 }, mulberry32(42));
    const second = Array.from({ length: 10 }, mulberry32(42));
    expect(first).toEqual(second);
  });

  it("gives different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays within [0, 1)", () => {
    const next = mulberry32(7);
    for (let index = 0; index < 2000; index += 1) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("createRandom", () => {
  it("produces integers inside the requested range, inclusive", () => {
    const random = createRandom(9);
    const seen = new Set<number>();

    for (let index = 0; index < 3000; index += 1) {
      const value = random.between(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      seen.add(value);
    }

    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("handles a single-value range", () => {
    expect(createRandom(1).between(5, 5)).toBe(5);
  });

  it("picks only from the given list", () => {
    const random = createRandom(4);
    const items = ["a", "b", "c"] as const;

    for (let index = 0; index < 100; index += 1) {
      expect(items).toContain(random.pick(items));
    }
  });

  it("refuses to pick from an empty list rather than returning undefined", () => {
    expect(() => createRandom(1).pick([])).toThrow();
  });
});

describe("hslToHex", () => {
  it("converts the primaries and secondaries", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(60, 100, 50)).toBe("#ffff00");
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
    expect(hslToHex(180, 100, 50)).toBe("#00ffff");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
    expect(hslToHex(300, 100, 50)).toBe("#ff00ff");
  });

  it("collapses to greyscale when saturation is zero", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(200, 0, 50)).toBe("#808080");
    expect(hslToHex(90, 0, 100)).toBe("#ffffff");
  });

  it("ignores hue at the extremes of lightness", () => {
    expect(hslToHex(0, 100, 0)).toBe("#000000");
    expect(hslToHex(240, 100, 100)).toBe("#ffffff");
  });

  it("wraps hue around the circle", () => {
    expect(hslToHex(360, 100, 50)).toBe(hslToHex(0, 100, 50));
    expect(hslToHex(480, 100, 50)).toBe(hslToHex(120, 100, 50));
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
  });

  it("clamps saturation and lightness rather than producing nonsense", () => {
    expect(hslToHex(0, 500, 50)).toBe("#ff0000");
    expect(hslToHex(0, -50, 50)).toBe("#808080");
    expect(hslToHex(0, 100, 500)).toBe("#ffffff");
  });

  it("always emits a well-formed lowercase hex triplet", () => {
    const random = createRandom(11);

    for (let index = 0; index < 500; index += 1) {
      const hex = hslToHex(
        random.between(0, 359),
        random.between(0, 100),
        random.between(0, 100),
      );

      // The product table's CHECK constraint enforces exactly this shape.
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Screaming Pumpkin")).toBe("screaming-pumpkin");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Rosé")).toBe("rose");
    expect(slugify("Naïve Café")).toBe("naive-cafe");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(slugify("Munsell & Daughters")).toBe("munsell-daughters");
    expect(slugify("a---b   c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Bone!  ")).toBe("bone");
  });

  it("produces slugs the route schema accepts", () => {
    const names = ["Screaming Pumpkin", "Rosé", "Munsell & Daughters", "Void №7"];

    for (const name of names) {
      expect(slugify(name), name).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
