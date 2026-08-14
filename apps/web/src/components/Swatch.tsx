/**
 * The product image.
 *
 * Falls back to the raw hex when no file exists, and picks its own caption ink
 * from the colour's WCAG relative luminance so a label on a pale yellow is as
 * readable as one on a navy.
 */

import {
  Option,
  parseHex,
  readableInkOn,
  type HexColour,
  type ProductImage,
} from "@hue/shared";
import { match } from "ts-pattern";

export type SwatchProps = Readonly<{
  hex: string;
  image: Option<ProductImage>;
  alt: string;
  caption?: string;
  className?: string;
}>;

/** Light ink is the safer default for a hex the server sent but we cannot parse. */
const inkClassFor = (hex: string): string =>
  Option.match<HexColour, string>({
    onSome: (valid) =>
      readableInkOn(valid) === "dark" ? "text-black/75" : "text-white/85",
    onNone: () => "text-white/85",
  })(parseHex(hex));

export const Swatch = ({ hex, image, alt, caption, className = "" }: SwatchProps) => (
  <div
    className={`swatch-ground relative overflow-hidden ${className}`}
    style={{ backgroundColor: hex }}
  >
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
        // No file: the colour itself is the image. Still needs a name.
        <div
          role="img"
          aria-label={alt}
          className="size-full"
          style={{ backgroundColor: hex }}
        />
      ))
      .exhaustive()}

    {match(caption)
      .with(undefined, () => null)
      .otherwise((text) => (
        <span
          className={`absolute bottom-2 right-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${inkClassFor(hex)}`}
        >
          {text}
        </span>
      ))}
  </div>
);
