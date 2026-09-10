/**
 * The hex on the wall beside the work, rather than printed on it.
 *
 * A card names the color it is showing, and the slab is the product: printing
 * on the product is not what a shop does. Frosted like the card's badge and
 * tags, so it stays legible whichever corner of the room it happens to sit on.
 */

import type { Option } from "@prism/shared";
import { match } from "ts-pattern";

/** What to print beside the work, where there is anything to print. */
export type PlacardProps = Readonly<{ caption: Option<string> }>;

/** A small frosted label in the corner of a stage. */
export const Placard = ({ caption }: PlacardProps) =>
  match(caption)
    .with({ _tag: "Some" }, ({ value }) => (
      <span className="stage__placard">{value}</span>
    ))
    .with({ _tag: "None" }, () => null)
    .exhaustive();
