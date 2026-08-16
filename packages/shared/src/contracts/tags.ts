/**
 * Tags, and the search box that understands them.
 *
 * A color's category is presented as a tag: stored singular ("gold"), typed
 * either way ("gold" or "golds"). Tags nest, so a color filed under "gold"
 * carries "yellow" too — the chain is derived from the category tree rather
 * than stored twice.
 *
 * The search box resolves a term against this vocabulary before it becomes a
 * text query, so typing "gloss" ticks the Gloss finish and typing "golds"
 * selects the gold tag. Both are pure functions over data the client already
 * holds, which is what keeps them testable without a browser.
 */

import { Option } from "../fp/option.ts";
import { FINISHES, type CategoryFacetBucket, type FacetBucket, type Finish } from "./catalog.ts";

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
 * What a submitted search term turns out to mean.
 *
 * A term that names a facet becomes that filter — the shopper who types
 * "gloss" wants gloss colors, not colors whose description says "gloss".
 * Everything else stays free text.
 */
export type ResolvedTerm =
  | Readonly<{ kind: "finish"; finish: Finish }>
  | Readonly<{ kind: "tag"; slug: string }>
  | Readonly<{ kind: "text"; text: string }>;

const finishNamed = (word: string): Option<Finish> =>
  Option.fromNullable(FINISHES.find((finish) => finish === word));

export const resolveSearchTerm = (
  term: string,
  tagSlugs: readonly string[],
): ResolvedTerm => {
  const trimmed = term.trim();
  const word = singular(trimmed);

  const finish = finishNamed(word);
  if (Option.isSome(finish)) return { kind: "finish", finish: finish.value };

  const tag = tagSlugs.find((slug) => singular(slug) === word);
  if (tag !== undefined) return { kind: "tag", slug: tag };

  return { kind: "text", text: trimmed };
};

/**
 * The tags a color carries: its own category and every category above it,
 * outermost first. "Gold" yields yellow, then gold.
 *
 * Returns nothing for a slug that is not in the tree, which is the honest
 * answer while a stale facet list is still on screen.
 */
export const tagChain = (
  categories: readonly CategoryFacetBucket[],
  slug: string,
): readonly FacetBucket[] => {
  const chain: FacetBucket[] = [];
  let current = categories.find((bucket) => bucket.value === slug);

  // The tree is finite and acyclic — `category_not_own_parent` and the closure
  // walk both depend on it — so following parents terminates.
  while (current !== undefined) {
    chain.unshift({ value: current.value, label: current.label, count: current.count });

    const parent = current.parentSlug;
    current = Option.isSome(parent)
      ? categories.find((bucket) => bucket.value === parent.value)
      : undefined;
  }

  return chain;
};
