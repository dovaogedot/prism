/**
 * Where the database's tagged union becomes the domain's tagged union.
 *
 * `product` stores one discriminant and one nullable column per variant field,
 * with a CHECK constraint that spells out which columns each kind must and must
 * not have. TypeScript cannot see that constraint, so this is the one place
 * that has to look — after which nothing downstream sees a null again.
 *
 * Pure: a row shape goes in and a `ProductSpec` comes out, which is what lets
 * it be tested without a database.
 */

import type {
  Finish,
  ProductKind,
  ProductSpec,
  ShiftDirection,
} from "@prism/shared";
import { Option } from "@prism/shared";
import { match, P } from "ts-pattern";

/** Exactly the columns a spec is built from, and nothing else. */
export type SpecColumns = Readonly<{
  kind: ProductKind;
  hex: string | null;
  finish: Finish | null;
  hue: number | null;
  saturation: number | null;
  lightness: number | null;
  durability: number | null;
  arcDegrees: number | null;
  direction: ShiftDirection | null;
}>;

/**
 * `None` is unreachable while `product_variant_shape` holds: every branch here
 * requires exactly the columns that constraint requires, and forbids nothing it
 * allows. It is an `Option` rather than a thrown error because the honest
 * response to a row that broke the constraint is to leave it out of the
 * catalog, not to take the catalog down with it.
 */
export const toProductSpec = (columns: SpecColumns): Option<ProductSpec> =>
  match(columns)
    .with(
      {
        kind: "color",
        hex: P.string,
        finish: P.not(P.nullish),
        hue: P.number,
        saturation: P.number,
        lightness: P.number,
      },
      ({ hex, finish, hue, saturation, lightness }) =>
        Option.some<ProductSpec>({
          kind: "color",
          hex,
          finish,
          hue,
          saturation,
          lightness,
        }),
    )
    .with(
      { kind: "finisher", finish: P.not(P.nullish), durability: P.number },
      ({ finish, durability }) =>
        Option.some<ProductSpec>({ kind: "finisher", finish, durability }),
    )
    .with(
      { kind: "shifter", direction: P.not(P.nullish), arcDegrees: P.number },
      ({ direction, arcDegrees }) =>
        Option.some<ProductSpec>({ kind: "shifter", direction, arcDegrees }),
    )
    .otherwise(() => Option.none);
