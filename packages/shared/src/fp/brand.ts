/**
 * Nominal typing. A `Brand<string, 'UserId'>` is not assignable to a
 * `Brand<string, 'ProductId'>`, so identifiers cannot be transposed at a call
 * site — the compiler catches it rather than the database.
 */

declare const tag: unique symbol;

/** `A`, distinguishable at compile time from every other brand of `A`. */
export type Brand<A, B extends string> = A & { readonly [tag]: B };
