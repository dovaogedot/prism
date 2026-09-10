/**
 * The stills a product's scene is rendered to.
 *
 * A color's slab and a finisher's room are drawn live in a browser that can
 * afford it. The same scenes are also rendered ahead of time, from a handful of
 * angles and under both themes, and stored as that product's images: they are
 * what a browser that draws nothing live shows, and what the strip under a
 * product's large picture is made of.
 *
 * The storefront renders them and the seed stores them, so the angles, the
 * themes and the names of the files are fixed here, where both can read them.
 */

import type { FinishApplication } from "./catalog.ts";

/** What a scene is built from: a color's paint, or the one thing a finisher does. */
export type StillSubject =
  | Readonly<{
      kind: "color";
      hex: string;
      roughness: number;
      coatingNanometers: number;
      emission: number;
    }>
  | (Readonly<{ kind: "finisher" }> & FinishApplication);

/** One product whose scene is to be rendered, named by the slug it is sold under. */
export type StillJob = Readonly<{ slug: string; subject: StillSubject }>;

/** Where the eye stands for one still, against where it stands in the live scene. */
export type StillAngle = Readonly<{
  /** The file this angle is stored under, before its theme. */
  name: string;
  /** How far the eye walks around what it is looking at, in degrees; positive is to its right. */
  aroundDegrees: number;
  /** How far it rises, in degrees above where it stands at rest. */
  upDegrees: number;
  /** Where it stands, as the end of "seen …" in a picture's words. */
  seenFrom: string;
}>;

/**
 * Every angle a product is rendered from, in the order its pictures are shown.
 *
 * The first is where the eye stands in the live scene before anybody points at
 * it, so the first picture of a product is what its live scene opens on. The
 * rest walk the eye to either side and up, no further than every room stays
 * closed at: past that, a still would show where a wall ends.
 */
export const STILL_ANGLES: readonly [StillAngle, ...StillAngle[]] = [
  { name: "front", aroundDegrees: 0, upDegrees: 0, seenFrom: "from the front" },
  { name: "left", aroundDegrees: -28, upDegrees: 0, seenFrom: "from the left" },
  { name: "right", aroundDegrees: 28, upDegrees: 0, seenFrom: "from the right" },
  { name: "above", aroundDegrees: 0, upDegrees: 18, seenFrom: "from above" },
];

/** The two themes every still is rendered under. */
export const STILL_THEMES = ["light", "dark"] as const;

/** One of the two themes a still is rendered under. */
export type StillTheme = (typeof STILL_THEMES)[number];

/** Where one still of one product is written, relative to the directory of all of them. */
export const stillPath = (slug: string, angle: StillAngle, theme: StillTheme): string =>
  `${slug}/${angle.name}-${theme}.webp`;
