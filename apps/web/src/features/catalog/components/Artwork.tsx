/**
 * What a product looks like, chosen by what it is.
 *
 * A color has a swatch, and a file behind it. The other two have neither: a
 * finisher and a shifter are drawn here from their own spec, so there is no
 * seeded image that could disagree with the numbers beside it, and no file on
 * the volume for something that is not a color.
 */

import {
  DIRECTION_LABELS,
  DIRECTION_SYMBOLS,
  Option,
  type Finish,
  type ProductImage,
  type ProductSpec,
  type ShiftDirection,
} from "@prism/shared";
import { match } from "ts-pattern";
import { Swatch } from "./Swatch.tsx";

/**
 * Each finish drawn as the thing it does to light: matte returns none of it,
 * gloss returns a hard highlight, iridescent disagrees with itself across the
 * tile, fluorescent goes off.
 */
const FINISH_GROUNDS: Record<Finish, string> = {
  matte: "linear-gradient(150deg, #4a4a4e, #35353a 60%, #2c2c30)",
  gloss:
    "linear-gradient(150deg, #6f7480 0%, #d8dce6 34%, #9aa0ae 52%, #55596a 100%)",
  iridescent:
    "conic-gradient(from 210deg, #7de3ff, #a78bfa, #fb7185, #fbbf24, #34d399, #7de3ff)",
  fluorescent:
    "radial-gradient(circle at 35% 30%, #f6ff8a 0%, #c6f542 40%, #52d726 100%)",
};

/** Dark ink on the two pale grounds, light on the two dark ones. */
const FINISH_INK: Record<Finish, string> = {
  matte: "text-white/85",
  gloss: "text-black/70",
  iridescent: "text-black/70",
  fluorescent: "text-black/75",
};

const FinishTile = ({
  finish,
  label,
}: Readonly<{ finish: Finish; label: string }>) => (
  <div
    role="img"
    aria-label={label}
    className="relative size-full"
    style={{ backgroundImage: FINISH_GROUNDS[finish] }}
  >
    {/*
      The finish is the whole picture. The durability is on the card's badge
      rather than here, so the two facts appear once each.
    */}
    <span
      className={`absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] font-semibold uppercase tracking-[0.2em] ${FINISH_INK[finish]}`}
    >
      {finish}
    </span>
  </div>
);

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

export type ArtworkProps = Readonly<{
  spec: ProductSpec;
  name: string;
  image: Option<ProductImage>;
  /** Colors show their hex under the swatch; the other two have nothing to show. */
  captioned?: boolean;
  className?: string;
}>;

export const Artwork = ({
  spec,
  name,
  image,
  captioned = false,
  className = "",
}: ArtworkProps) =>
  match(spec)
    .with({ kind: "color" }, (color) => (
      <Swatch
        hex={color.hex}
        image={image}
        alt={`${name} — ${color.hex}`}
        {...(captioned ? { caption: color.hex } : {})}
        className={className}
      />
    ))
    .with({ kind: "finisher" }, (finisher) => (
      <div className={`overflow-hidden ${className}`}>
        <FinishTile
          finish={finisher.finish}
          label={`${name} — puts back a ${finisher.finish} finish, ${finisher.durability} colors' worth`}
        />
      </div>
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
