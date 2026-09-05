/**
 * What a product looks like, chosen by what it is.
 *
 * A color gets a lit stage built from the three amounts of finish it carries.
 * The other two have no stage: a finisher and a shifter are drawn here from
 * their own spec, so there is nothing seeded that could disagree with the
 * numbers beside it, and nothing on the volume for something that is not a
 * color.
 */

import {
  DIRECTION_LABELS,
  DIRECTION_SYMBOLS,
  Option,
  type ProductImage,
  type ProductSpec,
  type ShiftDirection,
} from "@prism/shared";
import { match } from "ts-pattern";
import { ColorStage } from "./ColorStage.tsx";

/** The gray a finisher demonstrates on, which claims nothing about hue. */
const BARE_SLAB = "#8a8a8f";

/** The pigment a glowing finisher demonstrates on. */
const GLOWING_SLAB = "#7bd320";

/**
 * The pigment a finisher's surface is shown on.
 *
 * A tin holds no color, so its picture is the surface it leaves rather than a
 * color it comes in, and a gray carries roughness and a coating honestly. It
 * cannot carry a glow: fluorescence is a pigment taking light in and handing
 * it back in its own band, and a gray has no band to hand it back in — it
 * just goes white. So a tin that glows demonstrates on a saturated pigment.
 */
const substrateFor = (finishing: Readonly<{ emission: number }>): string =>
  finishing.emission > 0 ? GLOWING_SLAB : BARE_SLAB;

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
      <ColorStage
        hex={substrateFor(finisher)}
        finishing={{
          roughness: finisher.roughness,
          coatingNanometers: finisher.coatingNanometers,
          emission: finisher.emission,
        }}
        image={Option.none}
        alt={describeSurface(`${name} — the surface it leaves`, finisher)}
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
