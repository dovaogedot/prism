/**
 * `Option<A>` — the absence of a value, made explicit.
 *
 * CLAUDE.md forbids `null` and `undefined` as domain state. The repository
 * layer is the only place allowed to see a nullable column; it calls
 * `Option.fromNullable` on the way out and `Option.toNullable` on the way in,
 * so absence is a value the type system can reason about everywhere else.
 */

export type Some<A> = Readonly<{ _tag: "Some"; value: A }>;
export type None = Readonly<{ _tag: "None" }>;
export type Option<A> = Some<A> | None;

const some = <A>(value: A): Option<A> => ({ _tag: "Some", value });

const none: None = { _tag: "None" };

const isSome = <A>(option: Option<A>): option is Some<A> => option._tag === "Some";

const isNone = <A>(option: Option<A>): option is None => option._tag === "None";

/** The boundary inwards: a nullable value becomes an `Option`. */
const fromNullable = <A>(value: A | null | undefined): Option<NonNullable<A>> =>
  value === null || value === undefined ? none : some(value);

/** The boundary outwards: an `Option` becomes a nullable column value. */
const toNullable = <A>(option: Option<A>): A | null =>
  isSome(option) ? option.value : null;

/** An empty string, or any value failing `isPresent`, is absence in disguise. */
const fromPredicate =
  <A>(isPresent: (value: A) => boolean) =>
  (value: A): Option<A> =>
    isPresent(value) ? some(value) : none;

const map =
  <A, B>(transform: (value: A) => B) =>
  (option: Option<A>): Option<B> =>
    isSome(option) ? some(transform(option.value)) : none;

const flatMap =
  <A, B>(transform: (value: A) => Option<B>) =>
  (option: Option<A>): Option<B> =>
    isSome(option) ? transform(option.value) : none;

const filter =
  <A>(predicate: (value: A) => boolean) =>
  (option: Option<A>): Option<A> =>
    isSome(option) && predicate(option.value) ? option : none;

const getOrElse =
  <A>(fallback: () => A) =>
  (option: Option<A>): A =>
    isSome(option) ? option.value : fallback();

const orElse =
  <A>(alternative: () => Option<A>) =>
  (option: Option<A>): Option<A> =>
    isSome(option) ? option : alternative();

const match =
  <A, B>(cases: { onSome: (value: A) => B; onNone: () => B }) =>
  (option: Option<A>): B =>
    isSome(option) ? cases.onSome(option.value) : cases.onNone();

/** `[Some(1), Some(2)] -> Some([1, 2])`; a single `None` collapses the whole list. */
const all = <A>(options: readonly Option<A>[]): Option<readonly A[]> => {
  const values: A[] = [];
  for (const option of options) {
    if (isNone(option)) return none;
    values.push(option.value);
  }
  return some(values);
};

/** Drops absent entries instead of collapsing, for best-effort collections. */
const compact = <A>(options: readonly Option<A>[]): readonly A[] =>
  options.filter(isSome).map((option) => option.value);

export const Option = {
  some,
  none,
  isSome,
  isNone,
  fromNullable,
  toNullable,
  fromPredicate,
  map,
  flatMap,
  filter,
  getOrElse,
  orElse,
  match,
  all,
  compact,
} as const;
