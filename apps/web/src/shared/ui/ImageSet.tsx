import type { ProductImage } from "@prism/shared";

/** The picture, how wide it shows at each viewport, and whether the page is about it. */
export type ImageSetProps = Readonly<{
  className?: string;
  image: ProductImage;
  /** The `sizes` attribute: how wide the picture is drawn, so the browser fetches the copy that fits. */
  sizes: string;
  /** The picture a page is about: it loads first instead of when scrolled near. */
  isPriority?: boolean;
  /** A picture beside the name it shows, which a screen reader would only repeat. */
  isDecorative?: boolean;
}>;

/**
 * A product picture with every smaller copy in `srcset`, so the browser
 * downloads the one that fits the space and the screen. Its width and height
 * reserve the space before it loads. Pixel art is drawn with its pixels
 * repeated, never blurred.
 */
export const ImageSet = ({ className, image, sizes, isPriority = false, isDecorative = false }: ImageSetProps) => {
  const candidates = image.sources.map((source) => `${source.url} ${source.width}w`);
  const full = image.width === undefined ? [] : [`${image.url} ${image.width}w`];

  return (
    <img
      className={`${className ?? ""}${image.isPixelArt ? " [image-rendering:pixelated]" : ""}`}
      src={image.url}
      srcSet={candidates.length === 0 ? undefined : [...candidates, ...full].join(", ")}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={isDecorative ? "" : image.alt}
      loading={isPriority ? "eager" : "lazy"}
      fetchPriority={isPriority ? "high" : "auto"}
      decoding="async"
    />
  );
};
