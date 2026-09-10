/**
 * Walking two lists together.
 *
 * A room holds a fixed set of subjects and is handed a fresh arrangement for
 * them on every frame. Reading one list at the other's index is how that goes
 * wrong, so the two are joined into pairs first and the index never appears.
 */

/**
 * The two lists paired off, as far as the shorter one goes.
 *
 * Total: there is no index in the result that was not in both inputs, so no
 * pair is ever half absent however the two lengths differ.
 */
export const pairedWith = <A, B>(
  left: readonly A[],
  right: readonly B[],
): readonly (readonly [A, B])[] =>
  left.flatMap((value, at) => right.slice(at, at + 1).map((mate) => [value, mate] as const));
