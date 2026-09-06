/**
 * What a product looks like, chosen by what it is.
 *
 * A color gets a lit stage built from the three amounts of finish it carries.
 * A shifter has no stage either: it is drawn here from its own two numbers, so
 * there is nothing seeded that could disagree with the numbers beside it.
 *
 * A tin of finisher is the one kind that is photographed. It holds no color,
 * so a slab of it would be a slab of nothing; what it sells is what it does to
 * a color, and that can only be shown by showing it done. Those pictures are
 * rendered once at seed time from the tin's one amount, so they cannot drift
 * from it either.
 */

import {
  describeApplication,
  DIRECTION_LABELS,
  DIRECTION_SYMBOLS,
  type FinisherSpec,
  Option,
  type ProductImage,
  type ProductSpec,
  type ShiftDirection,
} from "@prism/shared";
import { match } from "ts-pattern";
import { ColorStage } from "./ColorStage.tsx";
import { Photograph } from "./Photograph.tsx";

/**
 * A surface written out as the three amounts that make it.
 *
 * What a screen reader is given in place of the picture, so it hears the same
 * three numbers the stage was built from rather than one word standing in for
 * them.
 */
const describeSurface = (
  opening: string,
  finishing: Readonly<{
    roughness: number;
    coatingNanometers: number;
    emission: number;
  }>,
): string =>
  [
    opening,
    `${finishing.roughness}% roughness`,
    finishing.coatingNanometers > 0
      ? `a ${finishing.coatingNanometers} nm coating`
      : "no coating",
    finishing.emission > 0 ? `glowing at ${finishing.emission}%` : "no glow",
  ].join(", ");

/** A tin written out, for a reader who has the words but not the pictures. */
const finisherAlt = (name: string, finisher: FinisherSpec): string =>
  `${name} — ${describeApplication(finisher)}`;

/**
 * The wheel, with the arc the shifter turns drawn on it.
 *
 * A clockwise shifter sweeps from 12 o'clock to `arc` degrees; a
 * counter-clockwise one sweeps back from 360. Two stops in a conic gradient
 * say all of that, and they are computed from the same two numbers the
 * measurements are, so the picture cannot drift from the data.
 */
const ShiftDial = ({
  direction,
  arcDegrees,
  label,
}: Readonly<{
  direction: ShiftDirection;
  arcDegrees: number;
  label: string;
}>) => {
  const sweep = match(direction)
    .with("cw", () => `from 0deg, var(--color-accent) 0deg ${arcDegrees}deg, transparent ${arcDegrees}deg`)
    .with("ccw", () => `from ${360 - arcDegrees}deg, var(--color-accent) 0deg ${arcDegrees}deg, transparent ${arcDegrees}deg`)
    .exhaustive();

  return (
    <div
      role="img"
      aria-label={label}
      className="relative grid size-full place-items-center bg-sunken"
    >
      {/* The hue circle itself, dimmed, so the arc reads as a selection on it. */}
      <div
        className="absolute inset-[18%] rounded-full opacity-30"
        style={{
          backgroundImage:
            "conic-gradient(hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))",
        }}
      />
      <div
        className="absolute inset-[18%] rounded-full"
        style={{ backgroundImage: `conic-gradient(${sweep})` }}
      />
      {/* Punched out, so the arc is a ring rather than a pie. */}
      <div className="absolute inset-[32%] rounded-full bg-surface" />

      <div className="relative text-center leading-none">
        <span aria-hidden="true" className="block text-lg text-ink-soft">
          {DIRECTION_SYMBOLS[direction]}
        </span>
        <span className="mt-1 block font-mono text-[11px] tabular-nums text-ink">
          {arcDegrees}°
        </span>
      </div>
    </div>
  );
};

/** Which product to draw, and how much room there is to draw it in. */
export type ArtworkProps = Readonly<{
  spec: ProductSpec;
  name: string;
  image: Option<ProductImage>;
  /** Colors print their hex on the slab; the other two have nothing to print. */
  captioned?: boolean;
  className?: string;
}>;

/** A product's picture: the stage for a color, and a drawn spec for the other two. */
export const Artwork = ({
  spec,
  name,
  image,
  captioned = false,
  className = "",
}: ArtworkProps) =>
  match(spec)
    .with({ kind: "color" }, (color) => (
      <ColorStage
        hex={color.hex}
        finishing={{
          roughness: color.roughness,
          coatingNanometers: color.coatingNanometers,
          emission: color.emission,
        }}
        image={image}
        alt={describeSurface(`${name} — ${color.hex}`, color)}
        {...(captioned ? { caption: color.hex } : {})}
        className={className}
      />
    ))
    .with({ kind: "finisher" }, (finisher) => (
      <Photograph
        image={image}
        alt={finisherAlt(name, finisher)}
        className={className}
      />
    ))
    .with({ kind: "shifter" }, (shifter) => (
      <div className={`overflow-hidden ${className}`}>
        <ShiftDial
          direction={shifter.direction}
          arcDegrees={shifter.arcDegrees}
          label={`${name} — turns a color ${shifter.arcDegrees}° ${DIRECTION_LABELS[shifter.direction].toLowerCase()}`}
        />
      </div>
    ))
    .exhaustive();
