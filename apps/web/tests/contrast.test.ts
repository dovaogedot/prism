/**
 * The palette's contrast, read from the color tokens in `styles.css` the way
 * a browser draws them: every text color on every background color passes
 * 4.5:1 in both themes, text on a filled button passes it too, and the focus
 * ring passes 3:1 against the page.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A color as `oklch(L% C h)` writes it: lightness in percent, chroma, hue in degrees. */
type Oklch = Readonly<{ lightness: number; chroma: number; hue: number }>;

const Oklch = {
  /** Every `--color-<name>: oklch(...)` declaration in `block`, by name. */
  tokensOf: (block: string): ReadonlyMap<string, Oklch> =>
    new Map(
      [...block.matchAll(/--color-([\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)].map((match) => [
        match[1] ?? "",
        { lightness: Number(match[2]), chroma: Number(match[3]), hue: Number(match[4]) },
      ]),
    ),

  /** Relative luminance as WCAG defines it, through OKLab and linear sRGB, clipped to the sRGB gamut. */
  luminance: (color: Oklch): number => {
    const lightness = color.lightness / 100;
    const a = color.chroma * Math.cos((color.hue * Math.PI) / 180);
    const b = color.chroma * Math.sin((color.hue * Math.PI) / 180);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clip = (channel: number) => Math.min(1, Math.max(0, channel));
    const red = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const green = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const blue = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  },

  contrast: (first: Oklch, second: Oklch): number => {
    const [lighter, darker] = [Oklch.luminance(first), Oklch.luminance(second)].toSorted((x, y) => y - x);
    return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
  },
} as const;

const css = readFileSync(new URL("../src/app/styles.css", import.meta.url), "utf8");
const light = Oklch.tokensOf(css.slice(css.indexOf("@theme"), css.indexOf(".dark {")));
const themes = [
  { name: "light", tokens: light },
  { name: "dark", tokens: new Map([...light, ...Oklch.tokensOf(css.slice(css.indexOf(".dark {"), css.indexOf("@layer base")))]) },
];

const texts = ["ink", "ink-soft", "ink-faint", "accent", "danger", "warn"];
const backgrounds = ["canvas", "surface", "sunken", "accent-wash", "danger-wash"];
/** Text on a filled control: the ink and the fill it sits on. */
const fills = [
  ["accent-ink", "accent"],
  ["accent-ink", "accent-hover"],
  ["danger-ink", "danger"],
];

describe.each(themes)("the $name theme", ({ tokens }) => {
  const color = (name: string): Oklch => {
    const found = tokens.get(name);
    if (found === undefined) throw new Error(`styles.css has no --color-${name}`);
    return found;
  };

  it("gives every text color 4.5:1 on every background", () => {
    const failing = texts.flatMap((text) =>
      backgrounds.map((background) => ({ text, background, ratio: Oklch.contrast(color(text), color(background)) })),
    ).filter(({ ratio }) => ratio < 4.5);

    expect(failing).toEqual([]);
  });

  it("gives the text on filled buttons 4.5:1", () => {
    for (const [ink = "", fill = ""] of fills) expect(Oklch.contrast(color(ink), color(fill)), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the focus ring 3:1 against the page and the panels", () => {
    for (const background of ["canvas", "surface"]) expect(Oklch.contrast(color("accent"), color(background))).toBeGreaterThanOrEqual(3);
  });
});

describe("the conversion", () => {
  it("matches WCAG's figures for black and white", () => {
    expect(Oklch.contrast({ lightness: 0, chroma: 0, hue: 0 }, { lightness: 100, chroma: 0, hue: 0 })).toBeCloseTo(21, 1);
    expect(Oklch.contrast({ lightness: 100, chroma: 0, hue: 0 }, { lightness: 100, chroma: 0, hue: 0 })).toBeCloseTo(1, 5);
  });
});
