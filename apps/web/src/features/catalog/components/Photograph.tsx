/**
 * A picture of a product, where there is a picture of it.
 *
 * A missing image is not an error and not an empty box: it is the same square
 * with nothing printed on it, still carrying the words, so a page whose media
 * has not been seeded keeps its shape and keeps its meaning.
 */

import { Option, type ProductImage } from "@prism/shared";
import { match } from "ts-pattern";

/** Which picture to show, and what to call it for a reader who cannot see it. */
export type PhotographProps = Readonly<{
  image: Option<ProductImage>;
  /** Read when the image carries no words of its own, and when there is none. */
  alt: string;
  className?: string;
}>;

/** One product image, or the space one would have taken. */
export const Photograph = ({ image, alt, className = "" }: PhotographProps) => (
  <div className={`overflow-hidden bg-sunken ${className}`}>
    {match(image)
      .with({ _tag: "Some" }, ({ value }) => (
        <img
          src={value.url}
          alt={value.alt.length > 0 ? value.alt : alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ))
      .with({ _tag: "None" }, () => (
        <div role="img" aria-label={alt} className="size-full" />
      ))
      .exhaustive()}
  </div>
);
