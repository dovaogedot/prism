/**
 * What a finisher's room is made of, from the one amount the finisher carries.
 *
 * The counterpart of `surfaceFor` for the other half of the catalog. A color
 * carries three amounts and a finisher carries one, so this fills the other
 * two in at what an unfinished surface is and hands the whole thing to
 * `surfaceFor` — which is what makes a finisher that leaves a surface at 20
 * and a color that is already at 20 render as the same material. Nothing here
 * looks at a finisher's name.
 */

import {
  COATING_ROUGHNESS_CEILING,
  ROUGHNESS_BOUNDS,
  type FinishApplication,
} from "@prism/shared";
import { match } from "ts-pattern";
import {
  glowFraction,
  surfaceFor,
  type Bloom,
  type Finishing,
  type Surface,
} from "./surfaces.ts";

/**
 * The gray every finisher is demonstrated on.
 *
 * A finisher has no color of its own, so it is shown on a neutral, and on the
 * same one for all of them: two finishers in the same room differ by what they
 * do to a surface and by nothing else.
 */
export const BARE_PIGMENT = "#8a8a8f";

/**
 * What an unfinished painted surface is, before a finisher touches it.
 *
 * Well below the matte floor, so there is a lacquer to take away and a grain
 * to add: a demonstration that starts at either end of the range has only one
 * direction to move in.
 */
const BARE_ROUGHNESS = 60;

/**
 * How smooth the surface under a coating being demonstrated is.
 *
 * Interference happens to a reflection, and the shop will not sell a coated
 * color on a surface that scatters its reflection away — so a room showing a
 * coating on one would be demonstrating something nothing in the catalog is.
 * The middle of the range a coating is sold on: the ceiling is the roughest
 * one survives rather than a surface anybody buys, and the floor is a mirror,
 * which returns the room instead of the shape it is poured over.
 */
const COATED_ROUGHNESS = (ROUGHNESS_BOUNDS.min + COATING_ROUGHNESS_CEILING) / 2;

/** How bright a plainly lit room is, which is what the other two are read against. */
const LIT_ROOM = 1.35;

/**
 * A coating has to be lit hard.
 *
 * Thin-film interference is a reflection, and a reflection is a picture of the
 * room: a dim room gives a coated surface nothing to be iridescent with, and
 * the colors it is bought for never appear. Well over a plainly lit room, so
 * the walls behind the subject carry light of their own and the coating has a
 * whole room to split rather than one lamp.
 */
const BRIGHT_ROOM = 2.4;

/** Two ends of a range a glowing room reads off its one amount. */
type GlowRange = Readonly<{
  /** What the value is where the pigment barely glows. */
  faintest: number;
  /** What it is where the pigment glows as hard as pigment glows. */
  brightest: number;
}>;

/** Where along a range a glow of this strength lands. */
const between = (range: GlowRange, glow: number): number =>
  range.faintest + glow * (range.brightest - range.faintest);

/** How lit a room is for a finisher that barely glows, and for one at full glow. */
const GLOW_ROOM: GlowRange = { faintest: 0.95, brightest: 0.75 };

/**
 * How far a glowing room's light spills off its subjects, at full glow.
 *
 * Far more than a slab of the same pigment spills. A slab is a color being
 * shown, and a halo around one is the picture lying about what the color is; a
 * glowing room is a demonstration of light leaving a surface, and the air
 * around a surface that light is leaving is where that reads.
 */
const GLOW_BLOOM = 0.5;

/**
 * How the spill grows as the glow does.
 *
 * Above one, so the spill is slow to start and then runs away with itself.
 * What a shopper is comparing is two finishers on the same shelf rather than
 * one against nothing, and the finishers on that shelf are spread over the top
 * half of the range — a spill straight in the amount separates them by the
 * same fraction they differ by, which is a difference nobody sees.
 */
const GLOW_BLOOM_CURVE = 1.8;

/**
 * How bright a face has to be before a glowing room spills it, in linear light.
 *
 * Under what a lit face reaches, unlike the ceiling a slab's spill sits above.
 * A slab spills only where the display has run out of range, which is a fact
 * about the display; here the spill is the subject of the picture. It comes
 * down as the glow goes up: a faint pigment spills only the brightest edge it
 * has, and a hard one spills across the whole of its lit side.
 */
const GLOW_BLOOM_FROM: GlowRange = { faintest: 0.7, brightest: 0.34 };

/** Everything one finisher's room is painted and lit by. */
export type FinisherRoom = Readonly<{
  /** The material every subject in the room is made of. */
  surface: Surface;
  /**
   * How bright the room's own lamps are, as a multiple of a plainly lit room.
   *
   * A property of what is being demonstrated rather than of the lamps: a
   * coating needs a room to reflect and a glow needs a room dark enough to
   * glow into.
   */
  light: number;
  /** What the bloom pass makes of the room. */
  bloom: Bloom;
}>;

/** The three amounts, with the two a finisher does not carry left bare. */
const finishingFor = (application: FinishApplication): Finishing =>
  match(application)
    .with({ applies: "roughness" }, ({ roughness }) => ({
      roughness,
      coatingNanometers: 0,
      emission: 0,
    }))
    .with({ applies: "coating" }, ({ coatingNanometers }) => ({
      roughness: COATED_ROUGHNESS,
      coatingNanometers,
      emission: 0,
    }))
    .with({ applies: "emission" }, ({ emission }) => ({
      roughness: BARE_ROUGHNESS,
      coatingNanometers: 0,
      emission,
    }))
    .exhaustive();

/**
 * The room one finisher is demonstrated in.
 *
 * Pure, and continuous in the amount: two finishers a point apart light and
 * paint a point apart, so there is no step anywhere for one of them to fall on
 * the wrong side of.
 */
export const roomFor = (application: FinishApplication): FinisherRoom => {
  const surface = surfaceFor(finishingFor(application));

  return match(application)
    .with({ applies: "roughness" }, () => ({
      surface,
      light: LIT_ROOM,
      // No spill. The lamps in a roughness room move, and a spill that travels
      // with a highlight turns a demonstration of a surface into a light show
      // — which is the one thing a shopper comparing two roughnesses cannot
      // see past.
      bloom: { strength: 0, threshold: surface.bloom.threshold },
    }))
    .with({ applies: "coating" }, () => ({
      surface,
      light: BRIGHT_ROOM,
      // Nothing in a coated room is over the threshold: interference moves
      // light between wavelengths rather than adding any.
      bloom: surface.bloom,
    }))
    .with({ applies: "emission" }, ({ emission }) => {
      const glow = glowFraction(emission);

      return {
        surface,
        // Darker the harder it glows. A pigment giving off its own light is
        // only legible against something that is not, and a room bright enough
        // to read a faint glow washes a strong one out.
        light: between(GLOW_ROOM, glow),
        bloom: {
          strength: GLOW_BLOOM * glow ** GLOW_BLOOM_CURVE,
          threshold: between(GLOW_BLOOM_FROM, glow),
        },
      };
    })
    .exhaustive();
};
