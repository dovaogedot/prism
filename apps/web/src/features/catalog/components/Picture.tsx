import type { ProductImage } from "@prism/shared";
import { ImageSet } from "../../../shared/ui/index.ts";

/** The picture, or nothing; the name its placeholder shows; how wide it is drawn; and whether the page is about it. */
export type PictureProps = Readonly<{
  className: string;
  image: ProductImage | undefined;
  name: string;
  sizes: string;
  isPriority?: boolean;
  /** A picture beside the name it shows, which a screen reader would only repeat. */
  isDecorative?: boolean;
}>;

/**
 * The picture, whole inside its box, or a plain block where there is none.
 * `sizes` says how wide it is drawn; the page's main picture loads first.
 */
export const Picture = ({ className, image, name, sizes, isPriority = false, isDecorative = false }: PictureProps) =>
  image === undefined ? (
    <div className={`${className} grid place-items-center bg-sunken text-3xl font-semibold text-ink-faint`} aria-hidden="true">
      {name.slice(0, 1)}
    </div>
  ) : (
    <ImageSet className={`${className} bg-sunken object-contain`} image={image} sizes={sizes} isPriority={isPriority} isDecorative={isDecorative} />
  );
