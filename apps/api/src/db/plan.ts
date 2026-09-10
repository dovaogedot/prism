/**
 * The catalog the seed plants, planned before anything is written.
 *
 * The palettes in `seed-data.ts` are how a plausible color gets invented — a
 * patch of HSL space and some words to name it with. None of that is stored:
 * a color keeps its hex, and which family it lands in is the database's
 * answer, not a label chosen here.
 *
 * Pure. Every value is drawn from the generator it is handed, so one state of
 * the generator plans one catalog: the seed plants it, and `npm run stills`
 * renders the stills of the same products without a database to read them
 * from.
 */

import {
  COATING_BOUNDS,
  COATING_ROUGHNESS_CEILING,
  EMISSION_BOUNDS,
  EMISSION_SPEAKS,
  FINISH_BANDS,
  FLUORESCENCE_FLOOR,
  Option,
  parseHex,
  ROUGHNESS_BOUNDS,
  saturationOf,
  SHIFT_DIRECTIONS,
  toRgb,
  type Finish,
  type FinishApplication,
  type HexColor,
  type ShiftDirection,
} from "@prism/shared";
import { match } from "ts-pattern";
import { hslToHex, shuffle, slugify, type Random } from "./palette.ts";
import {
  CATEGORIES,
  DESCRIPTION_NOTES,
  DIRECTION_NOTES,
  FINISHER_BRANCHES,
  FINISHER_NOTES,
  FINISHES,
  INSTRUMENT_NOTES,
  SHIFTER_BRANCHES,
  type InstrumentSeed,
  type LeafCategorySeed,
} from "./seed-data.ts";

/** Where the generator the catalog is planned from starts. */
export const SEED = 20260807;

const COLORS_PER_LEAF = 16;
const FINISHERS_PER_FINISH = 4;
const SHIFTERS_PER_BRANCH = 12;

/** Hue arcs may wrap through 0°, so interpolation has to go the long way round. */
const hueWithin = (
  arc: Readonly<{ from: number; to: number }>,
  random: Random,
): number => {
  const span = arc.to >= arc.from ? arc.to - arc.from : 360 - arc.from + arc.to;
  return (arc.from + random.between(0, span)) % 360;
};

/** The three amounts a finish is made of, which a color has and a finisher leaves. */
type Finishing = Readonly<{
  roughness: number;
  coatingNanometers: number;
  emission: number;
}>;

/** What every product has, whatever kind it turns out to be. */
type PlannedCommon = Readonly<{
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  stockQuantity: number;
}>;

/** One product the seed plants. Mirrors `ProductSpec`, so it cannot be half a variant. */
export type PlannedProduct = PlannedCommon &
  Readonly<
    | {
        kind: "color";
        hex: string;
        roughness: number;
        coatingNanometers: number;
        emission: number;
      }
    | ({ kind: "finisher" } & FinishApplication)
    | { kind: "shifter"; direction: ShiftDirection; arcDegrees: number }
  >;

/**
 * Names are generated from a branch's own vocabulary, so the same generator
 * serves all three kinds. Returns fewer than asked for rather than looping
 * forever when a small vocabulary runs out of unused combinations.
 */
const planNamed = <A>(
  wanted: number,
  words: Readonly<{ adjectives: readonly string[]; nouns: readonly string[] }>,
  random: Random,
  takenSlugs: Set<string>,
  build: (name: string, slug: string) => A,
): readonly A[] => {
  const planned: A[] = [];
  let attempts = 0;

  while (planned.length < wanted && attempts < wanted * 40) {
    attempts += 1;

    const name = `${random.pick(words.adjectives)} ${random.pick(words.nouns)}`;
    const slug = slugify(name);

    if (takenSlugs.has(slug)) continue;
    takenSlugs.add(slug);

    planned.push(build(name, slug));
  }

  return planned;
};

/** Three colors in ten carry a coating; the rest of the shelf is bare paint. */
const COATED_IN_TEN = 3;

/** And rather fewer glow, which is what makes the ones that do worth stocking. */
const GLOWING_IN_TEN = 2;

/** The saturation Postgres will derive from a hex this file just composed. */
const saturationOfHex = (hex: string): number =>
  Option.match<HexColor, number>({
    onSome: (parsed) => saturationOf(toRgb(parsed)),
    onNone: () => 0,
  })(parseHex(hex));

/**
 * The three amounts one color is made of.
 *
 * Two of the three are constrained by physics rather than by taste, and both
 * constraints run the same way — a finish that has nothing to happen in does
 * not happen. Fluorescence needs a band, so only a vivid enough pigment is
 * offered the roll. Interference needs a reflection, so a coated color is
 * given a surface smooth enough to have one; an uncoated color's roughness is
 * free across the whole axis.
 */
const planFinish = (random: Random, saturation: number): Finishing => {
  const coatingNanometers =
    random.between(1, 10) <= COATED_IN_TEN
      ? random.between(COATING_BOUNDS.min, COATING_BOUNDS.max)
      : 0;

  return {
    roughness: random.between(
      ROUGHNESS_BOUNDS.min,
      coatingNanometers > 0 ? COATING_ROUGHNESS_CEILING : ROUGHNESS_BOUNDS.max,
    ),
    coatingNanometers,
    // Never a barely-there glow: a pigment that fluoresces does it visibly or
    // is not sold as one.
    emission:
      saturation >= FLUORESCENCE_FLOOR && random.between(1, 10) <= GLOWING_IN_TEN
        ? random.between(EMISSION_SPEAKS, EMISSION_BOUNDS.max)
        : 0,
  };
};

const planColorsFor = (
  leaf: LeafCategorySeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  planNamed(COLORS_PER_LEAF, leaf, random, takenSlugs, (name, slug) => {
    const hex = hslToHex(
      hueWithin(leaf.hue, random),
      random.between(leaf.saturation.from, leaf.saturation.to),
      random.between(leaf.lightness.from, leaf.lightness.to),
    );
    // Read back off the hex rather than off the roll that made it: the hex is
    // what gets stored, and it is what the constraint on the glow is checked
    // against.
    const finish = planFinish(random, saturationOfHex(hex));

    return {
      kind: "color",
      slug,
      name,
      description: [`${name}. ${leaf.description}`, random.pick(DESCRIPTION_NOTES)].join(
        " ",
      ),
      hex,
      ...finish,
      priceCents: random.between(6, 48) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 140),
    };
  });

/**
 * The amounts one finisher leaves behind.
 *
 * Rolled inside the band the finish names, so a run of gloss finishers is a run of
 * genuinely different products — one leaves a surface at 20 and the next at 15,
 * and a shopper who wants the second is not served by being sold the first.
 *
 * One amount and no others, because a finisher does one thing: the two it is not
 * sold for are absent rather than zero, which is what makes "which finish is
 * this" a column rather than a threshold.
 */
const planFinisherFinish = (
  finish: Finish,
  random: Random,
): FinishApplication => {
  const band = FINISH_BANDS[finish];
  const amount = random.between(band.range.min, band.range.max);

  return match(band.property)
    .with("roughness", () => ({ applies: "roughness" as const, roughness: amount }))
    .with("coating", () => ({ applies: "coating" as const, coatingNanometers: amount }))
    .with("emission", () => ({ applies: "emission" as const, emission: amount }))
    .exhaustive();
};

/**
 * One run of finishers per finish, so every part of the space a finish name
 * covers has finishers in it.
 */
const planFinishersFor = (
  branch: InstrumentSeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  FINISHES.flatMap((finish) =>
    planNamed(FINISHERS_PER_FINISH, branch, random, takenSlugs, (name, slug) => {
      const finishing = planFinisherFinish(finish, random);

      return {
        kind: "finisher",
        slug,
        name,
        description: [
          `${name}. ${branch.description}`,
          FINISHER_NOTES[finish],
          random.pick(INSTRUMENT_NOTES),
        ].join(" "),
        ...finishing,
        priceCents: random.between(9, 70) * 100 + random.pick([0, 50, 99]),
        stockQuantity: random.between(0, 90),
      };
    }),
  );

/** Nudges turn a color a little; swings turn it into somebody else's problem. */
const planShiftersFor = (
  branch: InstrumentSeed,
  arc: Readonly<{ from: number; to: number }>,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  planNamed(SHIFTERS_PER_BRANCH, branch, random, takenSlugs, (name, slug) => {
    const direction = random.pick(SHIFT_DIRECTIONS);

    return {
      kind: "shifter",
      slug,
      name,
      description: [
        `${name}. ${branch.description}`,
        DIRECTION_NOTES[direction],
        random.pick(INSTRUMENT_NOTES),
      ].join(" "),
      direction,
      arcDegrees: random.between(arc.from, arc.to),
      priceCents: random.between(12, 90) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 70),
    };
  });

/**
 * Every product the seed plants, in the order it plants them.
 *
 * Draws from `random` and leaves it where the plan ends, so a caller that goes
 * on drawing from it draws the same numbers every time. Slugs are unique
 * across the whole plan.
 *
 * Planned branch by branch and handed back shuffled. Insertion order is the
 * only thing `created_at` records, and `created_at` is what the default sort
 * falls back to with no search term — so planting branch by branch would open
 * the shop on sixteen consecutive blacks, then a shelf of finishers.
 */
export const planCatalog = (random: Random): readonly PlannedProduct[] => {
  const takenSlugs = new Set<string>();
  const pending: PlannedProduct[] = [];

  for (const palette of CATEGORIES) {
    for (const leaf of palette.children) {
      pending.push(...planColorsFor(leaf, random, takenSlugs));
    }
  }

  for (const branch of FINISHER_BRANCHES) {
    pending.push(...planFinishersFor(branch, random, takenSlugs));
  }

  // A nudge and a swing are the same tool at different settings, so the arc
  // range is the only thing that separates the two runs.
  const arcRanges = { nudge: { from: 5, to: 45 }, swing: { from: 90, to: 300 } };

  for (const branch of SHIFTER_BRANCHES) {
    const arc = branch.slug === "nudge" ? arcRanges.nudge : arcRanges.swing;
    pending.push(...planShiftersFor(branch, arc, random, takenSlugs));
  }

  return shuffle(pending, random);
};
