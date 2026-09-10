/**
 * A product's pictures, one large and the rest as a strip under it.
 *
 * The list is non-empty by type, so there is no gallery of nothing to render
 * and no index that could point past the end: the picture on show is one of
 * the images themselves rather than a number that has to stay in range.
 *
 * A product whose pictures are stills of a scene the browser can draw live
 * hands that scene in as the lead, and the large frame shows it wherever the
 * first still would have been. The strip is unaffected — every thumbnail in it
 * is a picture, including the one that returns to the lead.
 */

import { Option, type ProductImage } from "@prism/shared";
import { useState, type ReactNode } from "react";
import { match, P } from "ts-pattern";
import { useThemeInForce } from "../../../shared/theme/in-force.ts";
import { urlUnder } from "../images.ts";
import { Photograph } from "./Photograph.tsx";

const FRAME = "aspect-square w-full rounded-[--radius-card] border border-line";
const THUMB = "aspect-square w-full overflow-hidden rounded-lg border transition-colors";

/** The pictures to show, and what to call one that carries no words of its own. */
export type GalleryProps = Readonly<{
  /** First is the one shown on arrival, matching the summary's primary image. */
  images: readonly [ProductImage, ...ProductImage[]];
  /**
   * Shown in place of the first picture, for a product that has a live one.
   *
   * Handed the classes the pictures are framed by, so what it draws stands in
   * exactly the box the picture it replaces would have taken.
   */
  lead?: (frame: string) => ReactNode;
  alt: string;
  className?: string;
}>;

/** Every picture of one product, with the strip left out when there is one. */
export const Gallery = ({ images, lead, alt, className = "" }: GalleryProps) => {
  const [showing, setShowing] = useState<ProductImage>(images[0]);
  const theme = useThemeInForce();

  return (
    <div className={`space-y-3 ${className}`}>
      {match({ lead, first: showing.url === images[0].url })
        .with({ lead: P.nonNullable, first: true }, ({ lead: live }) => live(FRAME))
        .otherwise(() => (
          <Photograph image={Option.some(showing)} alt={alt} className={FRAME} />
        ))}

      {match(images.length)
        .with(1, () => null)
        .otherwise(() => (
          <ul
            aria-label="Pictures"
            className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2"
          >
            {images.map((image) => (
              <li key={image.url}>
                <button
                  type="button"
                  onClick={() => setShowing(image)}
                  aria-pressed={image.url === showing.url}
                  className={`${THUMB} ${
                    image.url === showing.url
                      ? "border-accent"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  {/*
                    Empty alt, and the words on the button instead: a reader
                    tabbing the strip is choosing between pictures, and hearing
                    each sentence twice is not a second piece of information.
                  */}
                  <img
                    src={urlUnder(image, theme)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                  <span className="sr-only">{image.alt}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
};
