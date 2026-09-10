/**
 * A color as a flat rectangle of itself.
 *
 * What a color is shown as when nothing is drawing live pictures: the visitor
 * turned them off, or the browser cannot draw them. The still of its slab,
 * under the theme in force, where there is one, and the color itself where
 * there is not — which is the one thing about a color a shop cannot afford to
 * get wrong.
 *
 * The same box as a lit stage, down to the placard, so a card is the same size
 * and shape whichever of the two it is showing.
 */

import { Option, type ProductImage } from "@prism/shared";
import { match } from "ts-pattern";
import { useThemeInForce } from "../../../shared/theme/in-force.ts";
import { urlUnder } from "../images.ts";
import { Placard } from "./Placard.tsx";

/** Which color to lay out flat, and what to call it for a reader who cannot see it. */
export type SwatchProps = Readonly<{
  hex: string;
  image: Option<ProductImage>;
  alt: string;
  /** Colors on a card show their hex on a placard; the product page does not. */
  caption?: string;
  className?: string;
}>;

/** A flat rectangle of one color, in the box a lit stage would have taken. */
export const Swatch = ({
  hex,
  image,
  alt,
  caption,
  className = "",
}: SwatchProps) => {
  const theme = useThemeInForce();

  return (
    <div className={`stage ${className}`}>
      {match(image)
        .with({ _tag: "Some" }, ({ value }) => (
          <img
            src={urlUnder(value, theme)}
            alt={value.alt.length > 0 ? value.alt : alt}
            loading="lazy"
            decoding="async"
            className="stage__flat"
          />
        ))
        .with({ _tag: "None" }, () => (
          <div
            role="img"
            aria-label={alt}
            className="stage__flat"
            style={{ backgroundColor: hex }}
          />
        ))
        .exhaustive()}

      <Placard caption={Option.fromNullable(caption)} />
    </div>
  );
};
