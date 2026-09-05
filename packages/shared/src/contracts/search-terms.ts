/**
 * What a typed word turns out to mean.
 *
 * Nothing in the catalog is filed under a label. A product carries only what it
 * physically is, and every word a shopper might type is resolved against those
 * facts instead: "shifters" is a category, "cw" is a direction, "matte" is a
 * stretch of the roughness axis, and "gold" is a region of the color cube.
 * Anything left over is free text for full-text search.
 *
 * Pure functions over data the client already holds, which is what keeps them
 * testable without a browser and without a database.
 */

import { Option } from "../fp/option.ts";
import {
  COLOR_FAMILIES,
  FINISHES,
  PRODUCT_KINDS,
  type ColorFamily,
  type Finish,
  type ProductKind,
  type ShiftDirection,
} from "./catalog.ts";

/** Consonants that take "-es" rather than a bare "-s". */
const SIBILANT_ENDINGS = ["s", "x", "z", "ch", "sh"] as const;

const endsWithSibilant = (stem: string): boolean =>
  SIBILANT_ENDINGS.some((ending) => stem.endsWith(ending));

/**
 * English plurals, to the depth this catalog actually needs: "golds" → gold,
 * "navies" → navy, "blushes" → blush.
 *
 * Deliberately not a general pluralizer. It leaves anything it does not
 * recognize alone, and a word that only looks plural — "gloss" — survives
 * because "-ss" is not a plural ending.
 */
export const singular = (word: string): string => {
  const lower = word.toLowerCase();

  if (lower.length > 3 && lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;

  if (lower.length > 2 && lower.endsWith("es")) {
    const stem = lower.slice(0, -2);
    if (endsWithSibilant(stem)) return stem;
  }

  if (lower.length > 1 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }

  return lower;
};

/**
 * How each direction can be typed.
 *
 * The stored value is an abbreviation nobody says out loud, so the words people
 * do say resolve to it. Hyphens are stripped before the lookup, which is what
 * lets "clock-wise" and "clockwise" both land.
 */
const DIRECTION_WORDS: Readonly<Record<string, ShiftDirection>> = {
  cw: "cw",
  clockwise: "cw",
  ccw: "ccw",
  counterclockwise: "ccw",
  anticlockwise: "ccw",
};

/** What a submitted search term turns out to mean. */
export type ResolvedTerm =
  | Readonly<{ kind: "category"; category: ProductKind }>
  | Readonly<{ kind: "finish"; finish: Finish }>
  | Readonly<{ kind: "direction"; direction: ShiftDirection }>
  | Readonly<{ kind: "family"; family: ColorFamily }>
  | Readonly<{ kind: "text"; text: string }>;

const found = <A extends string>(
  vocabulary: readonly A[],
  word: string,
): Option<A> => Option.fromNullable(vocabulary.find((entry) => entry === word));

/**
 * The word a lookup is made against: singular, lowercase, and with the hyphens
 * out, so "Clock-Wise", "clockwise" and "clock-wises" are one word.
 */
const normalized = (term: string): string =>
  singular(term.trim().toLowerCase().replace(/-/g, ""));

/**
 * A term as the filter it names, or as free text.
 *
 * Tried coarsest first, and nothing collides: no finish, direction or family is
 * called color, finisher or shifter, and no family shares a name with a finish.
 */
export const resolveSearchTerm = (term: string): ResolvedTerm => {
  const word = normalized(term);

  const category = found(PRODUCT_KINDS, word);
  if (Option.isSome(category)) return { kind: "category", category: category.value };

  const finish = found(FINISHES, word);
  if (Option.isSome(finish)) return { kind: "finish", finish: finish.value };

  const direction = Option.fromNullable(DIRECTION_WORDS[word]);
  if (Option.isSome(direction)) {
    return { kind: "direction", direction: direction.value };
  }

  const family = found(COLOR_FAMILIES, word);
  if (Option.isSome(family)) return { kind: "family", family: family.value };

  return { kind: "text", text: term.trim() };
};
