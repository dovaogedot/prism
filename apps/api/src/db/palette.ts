/**
 * Color generation for the seed.
 *
 * `hslToHex` is the inverse of the database's `hex_to_hue`, `hex_to_saturation`
 * and `hex_to_lightness` — the seed composes a color from HSL and stores only
 * the hex, and Postgres derives the HSL back. The
 * integration tests round-trip the two against each other, which is a stronger
 * check on the SQL than a hand-written table of expected values.
 */

/** Deterministic PRNG, so `npm run seed` twice produces the same catalog. */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

/** The three ways the seed asks for a random value. */
export type Random = Readonly<{
  /** Float in [0, 1). */
  next: () => number;
  /** Integer in [min, max]. */
  between: (min: number, max: number) => number;
  pick: <A>(items: readonly A[]) => A;
}>;

/** A generator that produces the same sequence for the same seed. `pick` raises on an empty list. */
export const createRandom = (seed: number): Random => {
  const next = mulberry32(seed);

  const between = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  return {
    next,
    between,
    pick: <A>(items: readonly A[]): A => {
      const chosen = items[between(0, items.length - 1)];
      if (chosen === undefined) throw new Error("cannot pick from an empty list");
      return chosen;
    },
  };
};

/**
 * Fisher–Yates, driven by the seeded generator so a rebuild produces the same
 * order twice. Used to scatter the catalog across its branches at insert time:
 * `created_at` is what the default sort falls back to, so seeding branch by
 * branch would open the shop on a wall of whichever branch went in last.
 */
export const shuffle = <A>(items: readonly A[], random: Random): readonly A[] => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = random.between(0, index);
    const here = copy[index];
    const there = copy[target];

    // Both indices are in range by construction; this satisfies the compiler
    // without an assertion.
    if (here === undefined || there === undefined) continue;

    copy[index] = there;
    copy[target] = here;
  }

  return copy;
};

const toHexPair = (channel: number): string =>
  Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * HSL to `#rrggbb`. Hue in degrees, saturation and lightness as percentages.
 */
export const hslToHex = (
  hueDegrees: number,
  saturationPercent: number,
  lightnessPercent: number,
): string => {
  const hue = ((hueDegrees % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, saturationPercent)) / 100;
  const lightness = Math.max(0, Math.min(100, lightnessPercent)) / 100;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;

  const [red, green, blue] = ((): readonly [number, number, number] => {
    if (hue < 60) return [chroma, secondary, 0];
    if (hue < 120) return [secondary, chroma, 0];
    if (hue < 180) return [0, chroma, secondary];
    if (hue < 240) return [0, secondary, chroma];
    if (hue < 300) return [secondary, 0, chroma];
    return [chroma, 0, secondary];
  })();

  return `#${toHexPair(red + offset)}${toHexPair(green + offset)}${toHexPair(blue + offset)}`;
};

/** A name as a URL slug: lowercase, accents dropped, runs of anything else a single dash. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks left behind by NFKD (U+0300-U+036F).
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
