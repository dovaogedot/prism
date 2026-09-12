/**
 * Every scene the shop draws, as data.
 *
 * A scene is a pure function of what is being shown: the theme the page is in,
 * which kind of picture it is — a color's slab, or a finisher's room for a
 * surface, a glow or a coating — the product's own amount, and where the
 * pointer, the phone or a still has moved things to. From that, `scene` says
 * what the picture is made of: the shell it is drawn in, the subjects standing
 * in it and the paint on them, the lamps and where they hang, the eye and its
 * lens, the haze, the spill and the light in the air. Every number that
 * decides how a picture looks is here, in the section for the thing it sets,
 * and nothing that draws a picture (`render.ts`) carries a number of its own:
 * to change how a scene looks is to change the data below.
 *
 * Two things are read from elsewhere because they are not settings of a
 * scene. What a color's own finish is made of is `surfaces.ts`, the same
 * material wherever that color is drawn; and the surroundings every surface
 * reflects are `room.ts`, convolved once for the whole page.
 *
 * Two finishers in the same room differ by what they do to a surface and by
 * nothing else: the same shapes stand in the same places at the same sizes
 * wearing the same paint, and nothing in here looks at a finisher's name. World
 * units throughout, one unit being one width of the mesh at full size in a
 * finisher's room and one width of the slab in a color's. Pure, and radians
 * throughout.
 */

import {
  COATING_ROUGHNESS_CEILING,
  Option,
  parseHex,
  ROUGHNESS_BOUNDS,
  toRgb,
  type Rgb,
} from "@prism/shared";
import { match, P } from "ts-pattern";
import type { Theme } from "../../../shared/theme/use-theme.ts";
import {
  CORNER_BEARING,
  frontOf,
  MESH_REACH,
  type Placement,
  reachOf,
  RESTING_TILT,
  seenFrom,
  STANDING_DROP,
  STANDING_MIDDLE,
} from "./arrangement.ts";
import { hueShifted } from "./hueshift.ts";
import { LAGS, type Lamp, ringAt } from "./lightring.ts";
import { ELEVATION_BOUNDS, type Eye, eyeAt, type Orbit, REST_ORBIT, turnedBy } from "./orbit.ts";
import { pairedWith } from "./pairs.ts";
import { STRIP_LEAN } from "./room.ts";
import {
  type Bloom,
  emissiveScale,
  excite,
  type Finishing,
  glowFraction,
  type Surface,
  surfaceFor,
} from "./surfaces.ts";
import type { Tilt } from "./tilt.ts";
import {
  distanceAt,
  fieldOfViewAt,
  type Gaze,
  lookFrom,
  type Viewpoint,
} from "./viewpoint.ts";

/* ------------------------------------------------------- what a scene shows */

/** A color's picture: what color, made of what, standing at what angle, seen from where. */
export type ColorView = Readonly<{
  _tag: "Color";
  hex: string;
  /** The three amounts of finish the color carries. */
  finishing: Finishing;
  tilt: Tilt;
  viewpoint: Viewpoint;
}>;

/** A roughness finisher's picture: its amount and its lamps. */
export type RoughnessView = Readonly<{
  _tag: "Roughness";
  /** 5 is a mirror, 95 is chalk. */
  roughness: number;
  /** Where the four lamps have got to, as `lightring` has moved them. */
  lamps: readonly Lamp[];
  /** Where the room is looked at from. */
  viewpoint: Viewpoint;
}>;

/** A fluorescent finisher's picture: its amount and its eye. */
export type EmissionView = Readonly<{
  _tag: "Emission";
  /** How hard the pigment gives off its own light, out of 100. */
  emission: number;
  /** Where the eye has got to, as `orbit` has moved it. */
  orbit: Orbit;
  /** Where the room is looked at from, around wherever the orbit has put the eye. */
  viewpoint: Viewpoint;
}>;

/** A coating finisher's picture: its amount and its hue. */
export type CoatingView = Readonly<{
  _tag: "Coating";
  /** Nanometers of interference coating. */
  coatingNanometers: number;
  /** How far around the wheel every subject's hue has been carried, in degrees. */
  hueOffset: number;
  /** Where the room is looked at from. */
  viewpoint: Viewpoint;
}>;

/**
 * One finisher's picture.
 *
 * A sum, so the movement and the amount are narrowed together: there is no way
 * to hand a roughness room a hue offset, and a case that is forgotten does not
 * compile.
 */
export type FinisherView = RoughnessView | EmissionView | CoatingView;

/** One picture, of a color or of a finisher. */
export type View = ColorView | FinisherView;

/** The kinds of picture the shop draws. */
export type SceneType = View["_tag"];

/** The kinds of picture drawn in a finisher's room. */
export type RoomType = FinisherView["_tag"];

/** The two rooms with walls, which are one room with different things standing in it. */
type CornerType = Extract<RoomType, "Roughness" | "Coating">;

/** Everything a scene is drawn from: the theme the page is in, and what is being shown. */
export type SceneInput = Readonly<{ theme: Theme; view: View }>;

/* --------------------------------------------------- what a scene is made of */

/**
 * Where a subject stands and how it is turned.
 *
 * The three turns are applied about the subject's own axes in the order
 * `order` names, read from the last turn applied to the first: `YXZ` turns
 * about z, then x, then y.
 */
export type Transform = Readonly<{
  position: Eye;
  /** Radians about the x, y and z axes. */
  rotation: Eye;
  order: "XYZ" | "YXZ";
  /** How big, as a multiple of the shape's own size. */
  scale: number;
}>;

/**
 * The shape of a subject.
 *
 * A head is the vendored mesh of `mesh.ts`. A slab is a square with rounded
 * corners, one width across, extruded `depth` back and with an edge `bevel`
 * wide taken off all the way round; `corner` is the radius of its corners.
 */
export type Shape =
  | Readonly<{ _tag: "Head" }>
  | Readonly<{ _tag: "Slab"; corner: number; depth: number; bevel: number }>;

/**
 * The paint on a subject, in the terms a physical renderer understands.
 *
 * Everything but the two colors and the scalar on the second is a `Surface`,
 * which is what a color's own finish is made of.
 */
export type Material = Readonly<{
  /** The pigment, in sRGB out of 255 per channel. */
  color: Rgb;
  /** What the surface gives off on top of what it returns, in sRGB out of 255. */
  emissive: Rgb;
  /** The scalar on `emissive`: how much of it the surface gives off. */
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  sheen: number;
  clearcoat: number;
  clearcoatRoughness: number;
  iridescence: number;
  coatingNanometers: number;
  envIntensity: number;
  relief: number;
}>;

/** One shape standing in a scene, and the paint on it. Every subject casts a shadow. */
export type Subject = Readonly<{ shape: Shape; transform: Transform; material: Material }>;

/** How a lamp's shadow is drawn. */
export type Shadowing = Readonly<{
  /** Texels along one edge of the shadow map. */
  mapSize: number;
  /** How far the edge of what the lamp lays is spread, in map texels. */
  softness: number;
  /** Over how many samples that spread is taken. */
  blurSamples: number;
  /** How far a surface is pushed along its own normal before the map is read, in world units. */
  normalBias: number;
  /** How dark the shadow is drawn, from 0 to 1. */
  intensity: number;
}>;

/**
 * The shadow of a lamp whose light arrives from one direction.
 *
 * Its map covers a square `reach` either side of the middle of the room, out
 * to `far` from the lamp.
 */
export type DirectionalShadow = Shadowing & Readonly<{ reach: number; far: number }>;

/** The shadow of a cone lamp, whose map covers the cone from `near` to `far` from the lamp. */
export type SpotShadow = Shadowing & Readonly<{ near: number; far: number }>;

/**
 * One lamp in a scene.
 *
 * Colors are in sRGB out of 255 per channel. A directional lamp lights every
 * point from the one direction it stands in from the middle of the room, and a
 * point lamp from where it hangs. A cone is aimed at `aimedAt`, opens `angle`
 * radians either side of its axis and has its edge carried `penumbra` of the
 * way in toward it. A panel is a lit rectangle `width` by `height`, aimed at
 * `aimedAt` and leaned `lean` radians about its own facing. A hemisphere is
 * sky above and bounce below, and adds no highlight.
 */
export type Light =
  | Readonly<{
      _tag: "Directional";
      color: Rgb;
      intensity: number;
      at: Eye;
      shadow: Option<DirectionalShadow>;
    }>
  | Readonly<{
      _tag: "Spot";
      color: Rgb;
      intensity: number;
      at: Eye;
      aimedAt: Eye;
      angle: number;
      penumbra: number;
      shadow: Option<SpotShadow>;
    }>
  | Readonly<{ _tag: "Point"; color: Rgb; intensity: number; at: Eye }>
  | Readonly<{
      _tag: "RectArea";
      color: Rgb;
      intensity: number;
      at: Eye;
      aimedAt: Eye;
      width: number;
      height: number;
      lean: number;
    }>
  | Readonly<{ _tag: "Hemisphere"; sky: Rgb; ground: Rgb; intensity: number }>;

/** Where the eye stands, what it looks at, and what it sees through. */
export type Camera = Readonly<{
  eye: Eye;
  /** A point on its line of sight. */
  target: Eye;
  /** The lens, in degrees. */
  fieldOfView: number;
  /** Nearer than this, and further than `far`, nothing is drawn. */
  near: number;
  far: number;
}>;

/**
 * The surfaces a scene is drawn in, each with its paint in sRGB out of 255.
 *
 * A corner is a floor and the two walls that meet behind it, both `wallAt`
 * behind the middle and all three running `extent` across. A drum is a round
 * floor with one wall all the way around it, `height` high. A backdrop is one
 * wall `size` across, `distance` behind the middle, and no floor.
 */
export type ShellForm =
  | Readonly<{ _tag: "Corner"; wallAt: number; extent: number; walls: Rgb; floor: Rgb }>
  | Readonly<{ _tag: "Drum"; radius: number; height: number; walls: Rgb; floor: Rgb }>
  | Readonly<{ _tag: "Backdrop"; size: number; distance: number; wall: Rgb }>;

/** The shell of a scene, and the finish of every surface of it. */
export type Shell = Readonly<{
  form: ShellForm;
  /** How scattered the shell's own reflection is, from 0 to 1. */
  roughness: number;
  /** How much of the reflected surroundings the shell returns. */
  environment: number;
}>;

/**
 * A haze that closes a scene: everything fades from `near` to `far` along the
 * line of sight into what the frame is cleared to.
 */
export type Fog = Readonly<{ near: number; far: number }>;

/** The light in the air, and what is beyond the scene. */
export type Air = Readonly<{
  /** How much of the reflected surroundings every surface returns. */
  environment: number;
  /** What the frame is cleared to behind everything: this paint, at this level of light. */
  clear: Readonly<{ paint: Rgb; level: number }>;
}>;

/** Everything one picture is made of. */
export type Scene = Readonly<{
  shell: Shell;
  subjects: readonly Subject[];
  lights: readonly Light[];
  camera: Camera;
  fog: Option<Fog>;
  bloom: Bloom;
  air: Air;
}>;

/* ------------------------------------------------------------- the subjects */

/** A paint, from the hex it is written as. */
const paint = (hex: number): Rgb => ({
  red: (hex >> 16) & 0xff,
  green: (hex >> 8) & 0xff,
  blue: hex & 0xff,
});

/** No light at all, which is what a surface that gives off none gives off. */
const BLACK: Rgb = { red: 0, green: 0, blue: 0 };

/** The middle of a scene's floor. */
const ORIGIN: Eye = { x: 0, y: 0, z: 0 };

/**
 * One channel of a paint mixed on the wheel, `place` being how far round the
 * wheel the paint is from that channel's own hue.
 */
const channelAt = (low: number, high: number, place: number): number => {
  const turn = place < 0 ? place + 1 : place > 1 ? place - 1 : place;

  if (turn < 1 / 6) return low + (high - low) * 6 * turn;
  if (turn < 1 / 2) return high;
  if (turn < 2 / 3) return low + (high - low) * 6 * (2 / 3 - turn);

  return low;
};

/**
 * A paint mixed at one place on the wheel: `hue` in degrees, `saturation` and
 * `lightness` from 0 to 1.
 */
const mixed = (hue: number, saturation: number, lightness: number): Rgb => {
  const turn = (((hue / 360) % 1) + 1) % 1;
  const high =
    lightness <= 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const low = 2 * lightness - high;

  return {
    red: channelAt(low, high, turn + 1 / 3) * 255,
    green: channelAt(low, high, turn) * 255,
    blue: channelAt(low, high, turn - 1 / 3) * 255,
  };
};

/** How saturated and how light a demonstration pigment is mixed. */
type Pigment = Readonly<{ saturation: number; lightness: number }>;

/**
 * The gray every surface finisher is demonstrated on.
 *
 * A finisher has no color of its own, so it is shown on a neutral, and on the
 * same one for all of them.
 */
const BARE_PIGMENT = paint(0x8a8a8f);

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

/**
 * The pigment a glowing subject is mixed from.
 *
 * Saturated and half lit. Fluorescence hands back nearly all of one band, so
 * there has to be a band to hand back.
 */
const GLOWING_PIGMENT: Pigment = { saturation: 0.72, lightness: 0.5 };

/**
 * The pigment a coated subject is mixed from.
 *
 * Darker and less saturated than the glowing one. Interference lives in the
 * reflection, and the pigment's own color is added underneath it — so a bright
 * subject covers the coating it is standing there to demonstrate. What is left
 * is enough color to say which hue the subject is, because the hue is what the
 * pointer moves.
 */
const COATED_PIGMENT: Pigment = { saturation: 0.45, lightness: 0.2 };

/** The paint a glowing subject wears at `hue`: what the lamps in the room light and shade. */
const glowingPaint = (hue: number): Rgb =>
  mixed(hue, GLOWING_PIGMENT.saturation, GLOWING_PIGMENT.lightness);

/**
 * The band a glowing subject painted at `hue` gives off.
 *
 * A fluorescent pigment absorbs in one band and hands it back in another,
 * returning nearly all of it — so what it gives off is its own hue at full
 * strength, whatever strength the paint itself was mixed at.
 */
const glowingBand = (hue: number): Rgb => excite(glowingPaint(hue));

/**
 * How much of a glowing subject's own light is drawn as light leaving it.
 *
 * The rest is left to the lit paint underneath. A face gives off the same
 * amount at every point of itself, so a face drawn as its emission alone is
 * one value over a whole head — a patch of color with a head-shaped edge. This
 * is set against what the room's lamps put on that same head: near enough to
 * it that the two ends of the range are visibly different amounts of light,
 * and under it far enough that the shading, the highlight and the turn of a
 * cheek are still doing the drawing.
 */
const GLOW_MIX = 0.8;

/**
 * How hard a glow is turned up under each theme, as a multiple of it.
 *
 * A glow is read against the room it is in. The room dressed for a bright page
 * is the brighter of the two, and a glow held at the same strength in both is
 * lost against it: its faces are no brighter than the lit floor, so nothing
 * crosses the threshold a spill starts above and no pool shows where its light
 * lands.
 */
const GLOW_STRENGTH: Readonly<Record<Theme, number>> = { light: 2, dark: 1 };

/**
 * The arrangement each room stands.
 *
 * One subject for a grain, because a grain is read from a single highlight
 * traveling over a single surface and a second shape only splits the reading.
 * Three for a glow, close enough that the pool each of them lays on the floor
 * runs into the pools of the other two. Two for a coating, one of them near the
 * eye and one behind it and to the side, so the film's colors are seen over
 * two curvatures and at two distances at once.
 */
export const STANDING_IN: Readonly<Record<RoomType, readonly Placement[]>> = {
  Roughness: [seenFrom(0, 0, 0.5, 0.24)],
  // Each turned to face roughly where the eye rests, and each by a different
  // amount, so at rest all three faces are readable and none of them is the
  // same three-quarter view as its neighbor.
  Emission: [
    { x: 0.58, z: 0.92, scale: 0.44, turn: 0.18 },
    { x: -0.95, z: 0.12, scale: 0.4, turn: -0.12 },
    { x: 0.28, z: -1.06, scale: 0.47, turn: 0.34 },
  ],
  Coating: [seenFrom(0.85, 0.02, 0.52, 0.5), seenFrom(-0.75, 0.7, 0.46, -0.95)],
};

/**
 * The hues a glowing room paints its subjects, in degrees around the wheel.
 *
 * Cyan, magenta and yellow. Each of the three is two of the display's channels
 * at once, so each carries more light for the same paint than a red, a green
 * or a blue does — and what is being demonstrated is light coming off a
 * surface. Fixed rather than drawn from the product, because the three of them
 * together are the demonstration: one pigment glowing tells a shopper what a
 * glow costs on that hue, and three across the wheel tell them it costs the
 * same on any of them.
 */
export const GLOWING_HUES: readonly number[] = [180, 300, 60];

/**
 * The hues a coated room paints its subjects, in degrees around the wheel.
 *
 * A film's colors are added to whatever is under them, so what a base hue does
 * is decide which of them survive: the film's own returns near that hue are
 * lost in it and the ones across the wheel from it are strongest. A deep blue
 * and an amber, which are across the wheel from each other — so between the
 * two subjects both halves of what the film returns are shown against paint
 * that is not already that color. Of the pairs measured, this one leaves the
 * most tenths of the wheel colored on the worst product on the shelf.
 */
export const COATED_HUES: readonly number[] = [225, 45];

/** How much floor each room's arrangement needs, from its own middle. */
export const REACH: Readonly<Record<RoomType, number>> = {
  Roughness: reachOf(STANDING_IN.Roughness),
  Emission: reachOf(STANDING_IN.Emission),
  Coating: reachOf(STANDING_IN.Coating),
};

/** The shape every finisher is demonstrated on. */
const HEAD: Shape = { _tag: "Head" };

/**
 * The slab a color is shown on.
 *
 * The corners are the reason for its shape: a sharp-cornered box catches the
 * strip lamp as a point and reads as computer graphics, and a rounded one
 * catches it as a short bright arc, which is what an object looks like. Half a
 * degree of corner radius on a slab a meter across, in slab widths.
 */
const SLAB: Shape = { _tag: "Slab", corner: 0.055, depth: 0.05, bevel: 0.012 };

/**
 * The three amounts of a finisher's subject, with the two it does not carry
 * left at what an unfinished surface is.
 *
 * This is what makes a finisher that leaves a surface at 20 and a color that
 * is already at 20 render as the same material.
 */
const finishingOf = (view: FinisherView): Finishing =>
  match(view)
    .with({ _tag: "Roughness" }, ({ roughness }) => ({
      roughness,
      coatingNanometers: 0,
      emission: 0,
    }))
    .with({ _tag: "Coating" }, ({ coatingNanometers }) => ({
      roughness: COATED_ROUGHNESS,
      coatingNanometers,
      emission: 0,
    }))
    .with({ _tag: "Emission" }, ({ emission }) => ({
      roughness: BARE_ROUGHNESS,
      coatingNanometers: 0,
      emission,
    }))
    .exhaustive();

/** A surface painted `color`, giving off `emissive` at `emissiveIntensity`. */
const materialOf = (
  surface: Surface,
  color: Rgb,
  emissive: Rgb,
  emissiveIntensity: number,
): Material => ({
  color,
  emissive,
  emissiveIntensity,
  roughness: surface.roughness,
  metalness: surface.metalness,
  sheen: surface.sheen,
  clearcoat: surface.clearcoat,
  clearcoatRoughness: surface.clearcoatRoughness,
  iridescence: surface.iridescence,
  coatingNanometers: surface.coatingNanometers,
  envIntensity: surface.envIntensity,
  relief: surface.relief,
});

/**
 * A head lying where a placement puts it, wearing `material`.
 *
 * Tilted about its own left-right axis first and turned about the room's
 * vertical axis second, so each of them falls onto its own back rather than
 * every subject falling the same way across the floor whichever way it is
 * facing. Lifted by how far the tilted shape drops below its own middle, so
 * it rests on the floor.
 */
const head = (at: Placement, material: Material): Subject => ({
  shape: HEAD,
  transform: {
    position: { x: at.x, y: at.scale * STANDING_DROP, z: at.z },
    rotation: { x: RESTING_TILT, y: at.turn, z: 0 },
    order: "YXZ",
    scale: at.scale,
  },
  material,
});

/**
 * Everything standing in a scene, in the order it stands there.
 *
 * A glowing subject is a lit surface that also gives off light: its paint
 * stays what it was mixed at, for the lamps to light and shade, and its own
 * band is added on top. A color whose hex nobody can parse is not a color
 * anybody can draw, so its slab wears the wall's own paint and gives off
 * nothing; a color that glows both reflects and gives off the band it is
 * mixed from, because a pigment that fluoresces does it in a narrow band and
 * returns nearly all of it.
 */
export const subjects = ({ theme, view }: SceneInput): readonly Subject[] =>
  match(view)
    .with({ _tag: "Color" }, ({ hex, finishing, tilt }): readonly Subject[] => {
      const surface = surfaceFor(finishing);
      const pigment = Option.map(toRgb)(parseHex(hex));
      const band = Option.match<Rgb, Rgb>({ onSome: excite, onNone: () => BLACK })(pigment);
      const painted = Option.match<Rgb, Rgb>({
        onSome: (rgb) => rgb,
        onNone: () => SLAB_WALL[theme],
      })(pigment);

      return [
        {
          shape: SLAB,
          transform: {
            position: ORIGIN,
            rotation: { x: tilt.x, y: tilt.y, z: 0 },
            order: "XYZ",
            scale: 1,
          },
          material: materialOf(
            surface,
            surface.emission > 0 ? band : painted,
            band,
            emissiveScale(surface.emission, band),
          ),
        },
      ];
    })
    .with({ _tag: "Roughness" }, (rough): readonly Subject[] => {
      const surface = surfaceFor(finishingOf(rough));

      return STANDING_IN.Roughness.map((at) =>
        head(at, materialOf(surface, BARE_PIGMENT, BLACK, 0)),
      );
    })
    .with({ _tag: "Emission" }, (glow): readonly Subject[] => {
      const surface = surfaceFor(finishingOf(glow));
      const strength = GLOW_STRENGTH[theme];

      return pairedWith(STANDING_IN.Emission, GLOWING_HUES).map(([at, hue]) => {
        const band = glowingBand(hue);

        return head(
          at,
          materialOf(
            surface,
            glowingPaint(hue),
            band,
            GLOW_MIX * emissiveScale(surface.emission, band) * strength,
          ),
        );
      });
    })
    .with({ _tag: "Coating" }, (coat): readonly Subject[] => {
      const surface = surfaceFor(finishingOf(coat));

      // The same offset on every subject, so the two of them carry the
      // interval between their own hues around the wheel together.
      return pairedWith(STANDING_IN.Coating, COATED_HUES).map(([at, hue]) =>
        head(
          at,
          materialOf(
            surface,
            mixed(
              hueShifted(hue, coat.hueOffset),
              COATED_PIGMENT.saturation,
              COATED_PIGMENT.lightness,
            ),
            BLACK,
            0,
          ),
        ),
      );
    })
    .exhaustive();

/* ------------------------------------------------------------------ the eye */

/**
 * How wide a lens each scene is seen through, in degrees.
 *
 * A color's slab is seen through a long one, which is a product lens. Of the
 * rooms, the two with a subject near the eye are seen through a wide one. A
 * long lens has to stand back to fit the same shape in the frame, and from
 * back there the shape flattens into a card — while what a finish does to a
 * surface is read from how that surface turns away from the light. The glowing
 * room keeps a long lens: it is looked at from across a dark floor, and its
 * three subjects have to hold their sizes as the eye walks around them.
 */
export const FIELD_OF_VIEW: Readonly<Record<SceneType, number>> = {
  Color: 26,
  Roughness: 52,
  Emission: 34,
  Coating: 50,
};

/** Half of a lens's angle, in radians, which is what every framing is solved on. */
const halfLens = (fieldOfView: number): number => (fieldOfView * Math.PI) / 360;

/** How far back an eye stands to fit a sphere of this radius in this lens. */
export const distanceFor = (framed: number, fieldOfView: number): number =>
  framed / Math.tan(halfLens(fieldOfView));

/**
 * How much of the frame the near subject of a coated room is given.
 *
 * Of the half frame, and of a sphere that would hold the whole mesh — the head
 * lying inside that sphere is a good deal smaller than it, so this is short of
 * one and the subject still stops well inside the picture. What a coating
 * shows depends on the angle each patch of it is seen at, so the frame is
 * spent on one subject seen large enough for that angle to sweep across it.
 */
const COATED_SHARE = 0.84;

/** The subject a coated room is framed on, which is the one nearest the eye. */
const COATED_FRONT = frontOf(STANDING_IN.Coating);

/**
 * How far the eye stands from the middle of each room.
 *
 * A stage is square, so one framed radius covers both directions. The coated
 * room is measured off its near subject rather than off the whole arrangement:
 * that subject is what is being shown, and it stands in front of the middle,
 * so framing the arrangement puts it further away than it needs to be. The
 * roughness room frames a little wider than its one subject, and the glowing
 * room wider than its arrangement, because that arrangement is nearly flat and
 * never fills the frame the way its radius suggests.
 */
export const EYE_DISTANCE: Readonly<Record<RoomType, number>> = {
  Roughness: distanceFor(REACH.Roughness * 1.25, FIELD_OF_VIEW.Roughness),
  Emission: distanceFor(REACH.Emission * 0.95, FIELD_OF_VIEW.Emission),
  Coating:
    COATED_FRONT.toward + distanceFor(COATED_FRONT.reach / COATED_SHARE, FIELD_OF_VIEW.Coating),
};

/**
 * How far the eye orbits from the middle of a glowing room.
 *
 * Read by the stage, which turns the pointer into an orbit at this radius.
 */
export const EYE_RADIUS = EYE_DISTANCE.Emission;

/** How high the middle of a subject that reaches this far off its own axis is. */
const middleOf = (reach: number): number => (STANDING_MIDDLE * reach) / MESH_REACH;

/**
 * How high the eye stands, and the height it looks at, in each room.
 *
 * Every room looks at the middle of the subject nearest its eye, so what it is
 * being shown sits in the middle of the frame. The eyes themselves stand a
 * little above that, high enough to see the floor a subject stands on and low
 * enough to see it across its own curve rather than down onto its head. The
 * glowing room has no height of its own: its eye orbits, so where it stands is
 * whatever the orbit puts it at, and only what it looks at is fixed.
 */
export const EYE_HEIGHT = {
  Roughness: {
    stands: 1.05,
    looksAt: middleOf(frontOf(STANDING_IN.Roughness).reach),
  },
  Emission: { looksAt: middleOf(frontOf(STANDING_IN.Emission).reach) },
  Coating: { stands: 0.52, looksAt: middleOf(COATED_FRONT.reach) },
} as const;

/**
 * Where an eye stands to look into a corner.
 *
 * On the bearing both walls are equally in the picture from, which is the one
 * the arrangement in front of them is composed for.
 */
const cornerEye = (distance: number, height: number): Eye => ({
  x: distance * Math.sin(CORNER_BEARING),
  y: height,
  z: distance * Math.cos(CORNER_BEARING),
});

/** The middle of a roughness room's one subject, which stands in the middle of the floor. */
const ROUGHNESS_SUBJECT: Eye = { x: 0, y: EYE_HEIGHT.Roughness.looksAt, z: 0 };

/** Where each corner's eye rests, what it looks at, and what it walks around. */
export const CORNER_GAZE: Readonly<Record<CornerType, Gaze>> = {
  // Low and near. A rough surface and a smooth one differ most at a grazing
  // angle, where one returns the room in a line and the other spreads it over
  // the whole face.
  Roughness: {
    eye: cornerEye(EYE_DISTANCE.Roughness, EYE_HEIGHT.Roughness.stands),
    target: ROUGHNESS_SUBJECT,
    pivot: ROUGHNESS_SUBJECT,
  },
  // Higher than the roughness eye, because there is a second subject behind
  // the first and from any lower the near one covers it.
  Coating: {
    eye: cornerEye(EYE_DISTANCE.Coating, EYE_HEIGHT.Coating.stands),
    target: { x: 0, y: EYE_HEIGHT.Coating.looksAt, z: 0 },
    // The near subject, which the room is framed on. It stands in front of
    // the middle of the floor, so an eye that walked around the middle would
    // swing it out of the side of the picture.
    pivot: {
      x: COATED_FRONT.toward * Math.sin(CORNER_BEARING),
      y: EYE_HEIGHT.Coating.looksAt,
      z: COATED_FRONT.toward * Math.cos(CORNER_BEARING),
    },
  },
};

/** What a glowing room's eye looks at, wherever it has walked to. */
export const GLOW_TARGET: Eye = { x: 0, y: EYE_HEIGHT.Emission.looksAt, z: 0 };

/** The eye of a glowing room, wherever its orbit has walked it. */
const glowGaze = (orbit: Orbit): Gaze => {
  const orbiting = eyeAt(orbit, EYE_RADIUS);

  return {
    eye: { x: orbiting.x, y: GLOW_TARGET.y + orbiting.y, z: orbiting.z },
    target: GLOW_TARGET,
    pivot: GLOW_TARGET,
  };
};

/** How far the slab's eye stands back, in slab widths. */
const CAMERA_DISTANCE = 3.9;

/**
 * Where the slab's eye rests, straight in front of it, and what it looks at
 * and walks around: the middle of the slab.
 */
export const SLAB_GAZE: Gaze = {
  eye: { x: 0, y: 0, z: CAMERA_DISTANCE },
  target: ORIGIN,
  pivot: ORIGIN,
};

/** How near the eye anything is drawn, in world units. */
const NEAREST = 0.1;

/** An eye standing at `viewpoint` around where a scene's gaze rests, seeing as far as `far`. */
const eyeOf = (gaze: Gaze, kind: SceneType, viewpoint: Viewpoint, far: number): Camera => {
  const look = lookFrom(gaze, viewpoint, FIELD_OF_VIEW[kind]);

  return {
    eye: look.eye,
    target: look.target,
    fieldOfView: fieldOfViewAt(FIELD_OF_VIEW[kind], viewpoint),
    near: NEAREST,
    far,
  };
};

/** Where a scene is looked at from, and through what lens. */
export const camera = ({ view }: SceneInput): Camera =>
  match(view)
    .with({ _tag: "Color" }, ({ viewpoint }) =>
      eyeOf(SLAB_GAZE, "Color", viewpoint, SEES_TO.Color),
    )
    .with({ _tag: "Roughness" }, ({ viewpoint }) =>
      eyeOf(CORNER_GAZE.Roughness, "Roughness", viewpoint, SEES_TO.Roughness),
    )
    .with({ _tag: "Coating" }, ({ viewpoint }) =>
      eyeOf(CORNER_GAZE.Coating, "Coating", viewpoint, SEES_TO.Coating),
    )
    .with({ _tag: "Emission" }, ({ orbit, viewpoint }) =>
      eyeOf(glowGaze(orbit), "Emission", viewpoint, SEES_TO.Emission),
    )
    .exhaustive();

/* ---------------------------------------------------------------- the shell */

/**
 * How far behind the middle the two walls of a corner stand.
 *
 * Behind the deepest of the arrangements the corners stand, so that one
 * distance holds for both of them. It is what makes the two corners one room:
 * a lamp is only as bright on a wall as it is far from it, so two corners that
 * agree on every lamp and not on where their walls are do not agree on the
 * picture either.
 */
export const WALL_AT = Math.max(REACH.Roughness, REACH.Coating) * 1.9;

/**
 * How far the floor and walls of a corner run, as a multiple of how far back
 * they stand.
 *
 * Generous, because the alternative is an edge in the frame: a wall that stops
 * inside the picture is a panel standing in a void rather than a room.
 */
export const ROOM_EXTENT = 6;

/** How far the floor of the open room runs from the middle of it. */
const OPEN_RADIUS = REACH.Emission * 9;

/** How much taller than the frame the open room's wall is built. */
const OPEN_MARGIN = 1.2;

/**
 * The floor a glow is demonstrated on, and the wall that closes it.
 *
 * The room has no wall near enough to be lit by what stands in it — a wall
 * that close reports the glow instead of the subject — but it is closed all
 * the same. A floor that stops has an edge, and an eye lowered toward the
 * height of what it is looking at sees over that edge into nothing. The wall
 * stands far enough out to stay dark and rises past the top of the frame from
 * the lowest the eye can be put, which is where the frame reaches highest.
 */
export const OPEN_ROOM = {
  radius: OPEN_RADIUS,
  height:
    OPEN_MARGIN *
    (EYE_HEIGHT.Emission.looksAt +
      EYE_RADIUS * Math.sin(ELEVATION_BOUNDS.lowest) +
      (OPEN_RADIUS + EYE_RADIUS) *
        Math.tan(halfLens(FIELD_OF_VIEW.Emission) - ELEVATION_BOUNDS.lowest)),
} as const;

/**
 * How far the wall is behind a color's slab, in slab widths.
 *
 * Close, because the shadow lands on it: a wall further back takes the shadow
 * out of the picture with it and leaves the slab floating in front of nothing.
 */
export const WALL_DISTANCE = 0.36;

/**
 * How wide the wall behind a color's slab is, in slab widths.
 *
 * Comfortably wider than the frame at the wall's depth, from every viewpoint
 * a still is taken from.
 */
export const WALL_SIZE = 5;

/**
 * How far the eye can see in each scene, which is where its view is clipped.
 *
 * Past the far end of every shell, so nothing of one is ever cut off.
 */
const SEES_TO: Readonly<Record<SceneType, number>> = {
  Color: 40,
  Roughness: WALL_AT * ROOM_EXTENT * 2,
  Coating: WALL_AT * ROOM_EXTENT * 2,
  Emission: (OPEN_ROOM.radius + EYE_RADIUS) * 2,
};

/** What a walled room is painted, in each theme. */
type Paints = Readonly<{
  /** What every wall is painted, and so what the room fades into beyond its lamps. */
  walls: Rgb;
  /** What the floor is painted. */
  floor: Rgb;
}>;

/**
 * What a corner is painted, whichever of the two is being looked at.
 *
 * One set for both corners, so the two corners are one room. Dark paint under
 * the dark theme, because a room is looked at through the page it is on: a
 * wall mixed to sit inside a bright page is a lamp in a dark one. White walls
 * under the bright theme, so the far wall sits at about the page's own
 * lightness instead of reading as a gray box set into it, and a floor a gray
 * a little under the walls: a white floor under that much light sits at the
 * top of what the display can show, where a shadow and the floor around it
 * come out as the same white, and a gray one keeps every shadow the lamps lay
 * on it, and where two of them overlap.
 */
const CORNER_PAINT: Readonly<Record<Theme, Paints>> = {
  light: { walls: paint(0xffffff), floor: paint(0x8a8a8a) },
  dark: { walls: paint(0x3a3a3a), floor: paint(0x3a3a3a) },
};

/**
 * What the open room a glow is demonstrated in is painted.
 *
 * Its floor is never painted dark. What that floor is for is catching the
 * light coming off the subjects standing on it, and the pool it catches is the
 * whole of what says the light is leaving them; a floor painted as dark as the
 * shop's dark walls catches almost none of it, and the demonstration goes with
 * it. Under the bright theme its wall is white, so the haze its floor fades
 * into sits at about the page's own lightness, and its floor is a shade under
 * white: it is the paint that makes the floor light rather than more sky and
 * bounce, which land on the glowing faces too, light every side of them alike
 * and fade their color.
 */
const OPEN_PAINT: Readonly<Record<Theme, Paints>> = {
  light: { walls: paint(0xffffff), floor: paint(0xf4f4f4) },
  dark: { walls: paint(0x5a5a5a), floor: paint(0x5a5a5a) },
};

/**
 * What the wall behind a color's slab is painted: one neutral paint everywhere
 * on it, white so that under the bright theme it sits at about the page's own
 * lightness and the slab stands in the page rather than in a gray box set
 * into it.
 */
const SLAB_WALL: Readonly<Record<Theme, Rgb>> = {
  light: paint(0xffffff),
  dark: paint(0x232323),
};

/** Matte, so a room shows the light falling on it and not a reflection of it. */
const ROOM_FINISH = { roughness: 0.95, environment: 1 } as const;

/**
 * Flat, so the wall is the neutral ground a color is judged against: a ground
 * that is brighter in the middle than at the edges is a ground that reports a
 * different color depending on where on it the slab is standing.
 */
const SLAB_WALL_FINISH = { roughness: 0.96, environment: 0.3 } as const;

/** The surfaces a scene is drawn in, and their paint under the theme in force. */
export const shell = ({ theme, view }: SceneInput): Shell =>
  match(view)
    .with(
      { _tag: "Color" },
      (): Shell => ({
        form: {
          _tag: "Backdrop",
          size: WALL_SIZE,
          distance: WALL_DISTANCE,
          wall: SLAB_WALL[theme],
        },
        ...SLAB_WALL_FINISH,
      }),
    )
    .with(
      { _tag: "Emission" },
      (): Shell => ({
        form: { _tag: "Drum", ...OPEN_ROOM, ...OPEN_PAINT[theme] },
        ...ROOM_FINISH,
      }),
    )
    .otherwise(
      (): Shell => ({
        form: {
          _tag: "Corner",
          wallAt: WALL_AT,
          extent: WALL_AT * ROOM_EXTENT,
          ...CORNER_PAINT[theme],
        },
        ...ROOM_FINISH,
      }),
    );

/* --------------------------------------------------------------- the lights */

/**
 * What every lamp in a corner and the slab's strip burn: white, so the lamps
 * add no color of their own.
 */
const LAMP_COLOR = paint(0xffffff);

/**
 * Sky above and bounce below, which is what fills the shadows every lamp
 * leaves and gives a face turned away from every lamp a shape.
 */
const FILL = { sky: paint(0xeff3fb), ground: paint(0xcdc8c1) } as const;

/**
 * Sky and bounce, lit to `intensity`.
 *
 * A hemisphere contributes irradiance only, so it adds no second highlight
 * for a finish to be read from by mistake.
 */
const fill = (intensity: number): Light => ({
  _tag: "Hemisphere",
  sky: FILL.sky,
  ground: FILL.ground,
  intensity,
});

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

/** How bright a plainly lit room is, which every other level is read against. */
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

/**
 * How lit a glowing room is for a finisher that barely glows, and for one at
 * full glow.
 *
 * Darker the harder it glows. A pigment giving off its own light is only
 * legible against something that is not, and a room bright enough to read a
 * faint glow washes a strong one out.
 */
const GLOW_ROOM: GlowRange = { faintest: 0.95, brightest: 0.75 };

/**
 * How bright each room's lamps burn under each theme, as a multiple of a
 * plainly lit room's.
 *
 * At night a corner has no light in it but what its own lamps put there, and
 * dark paint returns little of that to the shadowed side of anything, so its
 * lamps are turned up. By day both corners burn at one level whatever the
 * finisher, so both sit at the page alike: at the coating's own level its
 * floor runs into the top of what the display can show while the roughness
 * room's is still a dark gray. A glowing room burns dimmer than either under
 * both themes, and dimmer still the harder its finisher glows, by `GLOW_ROOM`;
 * the bright page's room is lit little more than the dark page's, and it is
 * `GLOW_STRENGTH` that turns the glow up far enough to stand above the lit
 * floor.
 */
const LAMP_LEVEL = {
  Roughness: { light: 0.9, dark: LIT_ROOM * 1.25 },
  Coating: { light: 0.9, dark: BRIGHT_ROOM * 1.25 },
  Emission: { light: 0.5, dark: 0.6 },
} as const satisfies Readonly<Record<RoomType, Readonly<Record<Theme, number>>>>;

/** How bright a room's lamps burn for this picture, as a multiple of a plainly lit room's. */
const levelOf = (theme: Theme, view: FinisherView): number =>
  match(view)
    .with(
      { _tag: "Emission" },
      ({ emission }) => between(GLOW_ROOM, glowFraction(emission)) * LAMP_LEVEL.Emission[theme],
    )
    .otherwise(({ _tag }) => LAMP_LEVEL[_tag][theme]);

/**
 * How much of a room's light arrives from everywhere at once, as a multiple of
 * the level its lamps burn at, and how much of that is sky and bounce, as a
 * multiple of it.
 *
 * What arrives from everywhere at once is the surroundings every surface
 * reflects, the sky and bounce, and the paint the room fades into beyond its
 * lamps. The lamps are not part of it.
 */
type Ambience = Readonly<{ ambient: number; fill: number }>;

/**
 * The light in a corner's air.
 *
 * At night the fill is held well under the lamps: it opens the side of a
 * subject every lamp is turned away from, and light arriving from everywhere at
 * once fills the shadows on the floor in with it. By day a corner carries far
 * more of its light from everywhere at once, so the shaded side of its subject
 * stays open against the bright page, and most of that is fill rather than
 * surroundings to reflect: a coating reflects its surroundings and spreads
 * them around the hue wheel, and brighter surroundings bury the one hue the
 * pointer turns. Fill lands on the whole of the floor alike, so it also lifts
 * the band of floor under the walls, which the lamps reach least. It lifts
 * what is dim more than what is lit, so the lamps' scallops on the walls are
 * shallower by day than at night.
 */
const CORNER_AIR: Readonly<Record<Theme, Ambience>> = {
  light: { ambient: 5.5, fill: 1.4 },
  dark: { ambient: 1, fill: 0.3 },
};

/**
 * The light in the open room's air.
 *
 * At night it is held well under the lamps. Light arriving from everywhere at
 * once lights every side of a subject alike, and a subject lit on every side
 * reads as a painted object that also glows rather than as a light in a dark
 * room; the lamps still shade the subjects, and the glow still lays its pools
 * on the floor. By day the room carries far more of it, so the haze its floor
 * fades into sits at about the page's own lightness instead of reading as a
 * dim box in it.
 */
const OPEN_AIR: Readonly<Record<Theme, Ambience>> = {
  light: { ambient: 4.5, fill: 0.8 },
  dark: { ambient: 0.35, fill: 0.5 },
};

/** The light in the air of the room this picture is drawn in. */
const airOf = (theme: Theme, view: FinisherView): Ambience =>
  match(view)
    .with({ _tag: "Emission" }, () => OPEN_AIR[theme])
    .otherwise(() => CORNER_AIR[theme]);

/** How much light arrives from everywhere at once in this picture's room. */
const ambientOf = (theme: Theme, view: FinisherView): number =>
  airOf(theme, view).ambient * levelOf(theme, view);

/**
 * How far the edge of a cone lamp's light is carried in toward its own axis.
 *
 * All the way, which is the most a cone can be softened. A cone with any edge
 * left on it lays a disc of light with a rim, and a rim on a wall reads as a
 * second object standing in the room rather than as the room being lit.
 */
const CONE_SOFTNESS = 1;

/**
 * A cone lamp hung at `at`, aimed at `aimedAt` and opened `spread` radians
 * either side of its axis.
 */
const cone = (
  at: Eye,
  aimedAt: Eye,
  spread: number,
  color: Rgb,
  intensity: number,
  shadow: Option<SpotShadow>,
): Light => ({
  _tag: "Spot",
  color,
  intensity,
  at,
  aimedAt,
  angle: spread,
  penumbra: CONE_SOFTNESS,
  shadow,
});

/** How every lamp that lays a shadow in a room draws it, but for how far its edge is spread. */
const CASTING = { mapSize: 512, blurSamples: 16, normalBias: 0.03, intensity: 1 } as const;

/** Where one of the lamps a corner lays its shadows with hangs. */
type Caster = Readonly<{
  /** How far around from the reader it hangs, in radians; positive is to their right. */
  around: number;
  /** How high it hangs, in radians up from the middle of the floor. */
  elevation: number;
}>;

/**
 * Where the lamps a corner lays its shadows with hang.
 *
 * Cones, each aimed at the middle of the floor. A lamp that arrives from a
 * direction rather than from a place lights every point of a flat wall at one
 * angle and one strength, and a wall lit that way is one flat value from edge
 * to edge; a cone is brightest down its own axis and falls away toward its
 * edge, so what it spills past the subject onto a wall is a pool.
 *
 * Three, on three bearings. A subject lying on the floor has almost no gap
 * under it for a shadow to come out of, so two shadows are two only if they
 * leave it in different directions; one laid over the same ground as the
 * other is a darker version of one shadow. These leave to the left, to the
 * right and toward the reader.
 *
 * High, so each shadow stays close to what lays it. Lower lamps lay longer
 * shadows, and three long ones cover the whole floor in front of a subject
 * and fill one another in: what is left is one gray field rather than three
 * shapes with lit floor between them.
 */
const CORNER_CASTERS: readonly Caster[] = [
  // To the right. What it lays runs to the left.
  { around: Math.PI / 2, elevation: (50 * Math.PI) / 180 },
  // To the left. What it lays runs to the right.
  { around: -Math.PI / 2, elevation: (46 * Math.PI) / 180 },
  // Straight behind the middle, on the line the room is looked along. What it
  // lays runs out of the subject toward the reader.
  { around: Math.PI, elevation: (54 * Math.PI) / 180 },
];

/** How far a corner's casting lamps hang from the middle of its floor. */
const CASTER_REACH = 3;

/**
 * How much light one of a corner's casting lamps puts on the middle of the
 * floor it is aimed at.
 */
const CASTER_POWER = 3.4;

/**
 * How bright one of a corner's casting lamps is, in candela.
 *
 * The squared distance is there because light falls off with the square of
 * how far it has traveled, which is what makes `CASTER_POWER` a measure of the
 * light that arrives rather than of the light that leaves.
 */
const CASTER_LIGHT = CASTER_POWER * CASTER_REACH ** 2;

/**
 * How wide open a casting lamp is, as a half-angle in radians.
 *
 * Wide enough to cover every subject either corner stands and the shadows that
 * leave them. It is also what a casting lamp's shadow map is spread over, so a
 * cone opened wider than the arrangement asks for is a softer, fainter shadow.
 */
const CASTER_SPREAD = Math.PI / 4.5;

/**
 * How a casting lamp's shadow is drawn.
 *
 * Its edge is spread little. A shadow is told apart from the floor around it
 * by its edge, and an edge spread wider than the step it makes reads as the
 * floor darkening toward one side rather than as a shape lying on it. Its map
 * reaches from just in front of the lamp to past the far wall.
 */
const CASTER_SHADOW: SpotShadow = {
  ...CASTING,
  softness: 2,
  near: 0.5,
  far: CASTER_REACH + WALL_AT * 2,
};

/** One of the lamps a corner washes a wall with. */
type Wash = Readonly<{
  /** Where it hangs. */
  at: Eye;
  /** The point on the wall its cone is built around. */
  aimedAt: Eye;
}>;

/**
 * The lamps a corner lights its two walls with.
 *
 * One each, hung high and close in front of its own wall, and pointed down it.
 * A lamp that near a wall and that steep to it lays a scallop: bright where
 * its cone first meets the wall, falling away down toward the floor and out to
 * either side, and dark above it, where the cone never reaches. Each hangs in
 * the middle of the stretch of its wall that either corner's eye can see.
 */
const CORNER_WASHES: readonly Wash[] = [
  { at: { x: -1.5, y: 1.55, z: -WALL_AT + 0.4 }, aimedAt: { x: -1.5, y: 0, z: -WALL_AT } },
  { at: { x: -WALL_AT + 0.4, y: 1.55, z: -1.5 }, aimedAt: { x: -WALL_AT, y: 0, z: -1.5 } },
];

/** How bright one of a corner's wall lamps is, in candela. */
const WASH_LIGHT = 5;

/** How wide open a wall lamp is, as a half-angle in radians. */
const WASH_SPREAD = Math.PI / 3.6;

/**
 * How far a corner's ring of lamps hangs from the middle of that corner.
 *
 * Outside the deepest arrangement a corner stands, so no lamp on the ring ever
 * ends up inside a subject, and inside the walls at every elevation the
 * pointer can carry the ring to — a lamp behind a wall lights the back of it,
 * and the back of a wall is the side the room cannot see. Both corners hang
 * their ring at this one radius.
 */
export const LAMP_RADIUS = 3;

/**
 * Where a corner's ring of lamps rests.
 *
 * Turned onto the bearing the corner is looked into from, which puts one lamp
 * over the reader's shoulder and lights what they are looking at. A roughness
 * room's pointer turns the whole ring away from here; a coated room's leaves
 * it where it is.
 */
export const RING_AT_REST: Orbit = turnedBy(REST_ORBIT, CORNER_BEARING);

/** How many lamps hang on a corner's ring: one per lag `lightring` moves them at. */
const RING_LAMPS = LAGS.length;

/**
 * How much light one lamp on a corner's ring puts on what the ring circles.
 *
 * Held well under what the lamps that cast put there. The ring lays no shadow
 * of its own, so every point of it is light arriving in the shadows the other
 * lamps lay — and a shadow filled back in is a smudge rather than a shape
 * lying on the floor.
 */
const RING_POWER = 0.5;

/**
 * How bright one lamp on a corner's ring is, in candela.
 *
 * The squared radius is there for the same reason it is in `CASTER_LIGHT`.
 */
const RING_LIGHT = RING_POWER * LAMP_RADIUS ** 2;

/**
 * How wide open a lamp on a corner's ring is, as a half-angle in radians.
 *
 * Wide enough that the cone covers what stands inside the ring and carries on
 * past it onto the far wall, which is where the lamp's own falloff is read
 * from. A cone is aimed at the middle of the floor and the middle of the floor
 * is not where most of the light in it ends up.
 */
const RING_SPREAD = Math.PI / 3.6;

/**
 * Every lamp a corner is lit by, with its ring standing at `ring`.
 *
 * Both corners are lit by this and by nothing else, off numbers that name
 * neither room: the two corners are the same room with different things
 * standing in it, and a shopper moving from one shelf to the other is meant to
 * see the finish change and nothing else. The fill first, then the three that
 * cast, the two that light the walls, and the ring.
 */
const cornerLights = (
  theme: Theme,
  view: RoughnessView | CoatingView,
  ring: readonly Eye[],
): readonly Light[] => {
  const level = levelOf(theme, view);
  const ambient = ambientOf(theme, view);

  return [
    fill(CORNER_AIR[theme].fill * ambient),
    ...CORNER_CASTERS.map((caster) =>
      cone(
        eyeAt(
          { azimuth: CORNER_BEARING + caster.around, elevation: caster.elevation },
          CASTER_REACH,
        ),
        ORIGIN,
        CASTER_SPREAD,
        LAMP_COLOR,
        CASTER_LIGHT * level,
        Option.some(CASTER_SHADOW),
      ),
    ),
    ...CORNER_WASHES.map((wash) =>
      cone(wash.at, wash.aimedAt, WASH_SPREAD, LAMP_COLOR, WASH_LIGHT * level, Option.none),
    ),
    ...ring.map((at) =>
      cone(at, ORIGIN, RING_SPREAD, LAMP_COLOR, RING_LIGHT * level, Option.none),
    ),
  ];
};

/**
 * The lamp a glowing room shades its subjects with, in candela.
 *
 * Fixed, high and to one side. Light leaves a fluorescent face at the same
 * strength wherever on the face it leaves from, so a face drawn from its own
 * light alone has no shading anywhere on it and reads as a colored patch. This
 * is what puts the turn of a cheek and the shadow under a brow back, and the
 * eye walks around it, which sweeps both across the subjects as it goes.
 */
const GLOW_KEY = 3.2;

/**
 * What the open room's second lamp is worth, against its first.
 *
 * Well under it. Two lamps of one strength lay two shadows of one darkness and
 * neither of them reads as the shadow; a second under the first lays a lighter
 * one the other way, which is what says the light in the room comes from more
 * than one place. It is also what opens the side of a subject the first lamp
 * is turned away from, so a face has a dark side rather than a black one.
 */
const SIDE_SHARE = 0.6;

/** Where the open room's two lamps stand, and what each burns: the first warm, the second cool. */
const OPEN_LAMPS = {
  key: { at: { x: 2.1, y: 3.4, z: 2.4 }, color: paint(0xfff6ec) },
  side: { at: { x: -2.6, y: 1.9, z: -1.8 }, color: paint(0xe6eeff) },
} as const;

/**
 * How far the edge of each of the open room's two shadows is spread, in texels.
 *
 * The first lamp is the one the eye reads as the light in the room, and the
 * shadow it lays is what puts a subject on the floor. The second stands wider
 * and lays a shadow spread far enough that it reads as the room's own light
 * failing to reach behind something rather than as a second object.
 */
const OPEN_SOFTNESS = { key: 6, side: 13 } as const;

/** How far past the far wall of a room a directional lamp's shadow map reaches. */
const LAMP_SHADOW_FAR = 24;

/**
 * The shadow one of the open room's lamps lays, over a square `reach` either
 * side of the middle of the floor.
 */
const lampShadow = (reach: number, softness: number): DirectionalShadow => ({
  ...CASTING,
  softness,
  reach,
  far: LAMP_SHADOW_FAR,
});

/**
 * What a glowing subject puts into the air around it, per unit of its own glow.
 *
 * A fluorescent face is a light source, and a renderer that only draws it
 * bright shows a picture of one rather than one. This is the pool it lays on
 * the floor under itself, which is what says the light is leaving the surface.
 */
const GLOW_LAMP = 1.3;

/**
 * How wide open the lamp inside a glowing subject is, as a half-angle.
 *
 * Nearly the whole half-space below it, which is as wide as a cone goes. What
 * it stands for is light leaving a surface in every direction, and the part of
 * that worth drawing is the pool it lays on the floor — so the cone is opened
 * until the pools of neighboring subjects run into one another, and the light
 * between them is what says all three are giving it off.
 */
const POOL_SPREAD = Math.PI / 2.2;

/**
 * Every lamp the open room is lit by: the fill, the two lamps that shade and
 * lay the shadows, and the lamp inside each glowing subject, aimed straight
 * down at the floor it is standing on from where the light it stands for
 * comes from.
 */
const openLights = (theme: Theme, view: EmissionView): readonly Light[] => {
  const level = levelOf(theme, view);
  const ambient = ambientOf(theme, view);
  const surface = surfaceFor(finishingOf(view));
  const strength = GLOW_STRENGTH[theme];

  return [
    fill(OPEN_AIR[theme].fill * ambient),
    {
      _tag: "Directional",
      color: OPEN_LAMPS.key.color,
      intensity: GLOW_KEY * level,
      at: OPEN_LAMPS.key.at,
      shadow: Option.some(lampShadow(REACH.Emission * 1.3, OPEN_SOFTNESS.key)),
    },
    {
      _tag: "Directional",
      color: OPEN_LAMPS.side.color,
      intensity: GLOW_KEY * SIDE_SHARE * level,
      at: OPEN_LAMPS.side.at,
      shadow: Option.some(lampShadow(REACH.Emission * 1.7, OPEN_SOFTNESS.side)),
    },
    ...pairedWith(STANDING_IN.Emission, GLOWING_HUES).map(([at, hue]) =>
      cone(
        { x: at.x, y: at.scale * STANDING_DROP, z: at.z },
        { x: at.x, y: 0, z: at.z },
        POOL_SPREAD,
        glowingBand(hue),
        surface.emission * GLOW_LAMP * strength,
        Option.none,
      ),
    ),
  ];
};

/**
 * How bright a color's room is under each theme.
 *
 * Bright, because the color is the product: a face turned to the camera has to
 * come back reading as the hex it is sold under, which takes about as much
 * light as the paint reflects. Split between the key and the fill, and the
 * split is the whole of how much a finish answers being turned. A hemisphere
 * light has no direction, so light spent there lands the same however the slab
 * stands — a room lit almost entirely by fill leaves a matte face looking
 * identical at every angle, which is the one thing matte paint does not do.
 * Light spent on the key comes back as a second broad specular on a lacquered
 * face, which is one highlight more than the picture has room for beside the
 * strip. This is the balance where a matte face visibly shades across a turn
 * and a gloss one still has only one reflection on it.
 *
 * The dark room is not the same room turned down: a dark room has a dark wall,
 * so the lamp has to work slightly harder for the slab to keep its own color,
 * and its strip is brighter because there is somewhere for a spill to go. The
 * strip's intensity is radiance rather than power — how bright its surface is
 * and not how much light it puts out — so a longer strip at the same number is
 * a brighter room. `environment` is how much of the reflected room each face
 * returns.
 */
const SLAB_ROOM = {
  light: { environment: 1.15, key: 2.5, fill: 2.35, strip: 1.15 },
  dark: { environment: 0.95, key: 2.6, fill: 2.05, strip: 1.5 },
} as const satisfies Readonly<
  Record<Theme, Readonly<{ environment: number; key: number; fill: number; strip: number }>>
>;

/**
 * The lamp that lights a color's face and throws its shadow.
 *
 * Round to the side, about thirty-eight degrees off the camera's axis. How far
 * off decides how much a face answers being turned: the cosine of the angle
 * to the lamp barely moves through thirteen degrees when the lamp is straight
 * ahead, and moves by a fifth when it is out here. That swing is the whole of
 * a matte finish's response, since a flat face has no highlight to slide.
 * Further round still would buy more of it and cost the shadow: past about
 * forty degrees the slab stops standing in front of its own shadow and starts
 * standing beside a dark rectangle.
 *
 * Its shadow is soft to the point of being a smudge: nothing in the scene is
 * small enough for a defined shadow to describe, and a defined one only
 * announces that the wall is a foot away. And it is barely there: a slab a
 * third of a width off the wall blocks very little of a room lit mostly by its
 * own air, and a shadow with any weight to it reads as a second object lying
 * behind the product rather than as depth.
 */
const SLAB_KEY = {
  at: { x: -1.7, y: 1.8, z: 3.1 },
  color: paint(0xfffaf4),
  shadow: {
    mapSize: 512,
    softness: 8,
    blurSamples: 8,
    normalBias: 0.04,
    intensity: 0.22,
    reach: 1.6,
    far: 14,
  },
} as const satisfies Readonly<{ at: Eye; color: Rgb; shadow: DirectionalShadow }>;

/**
 * The strip, which is the reflection a color's finishes are read from.
 *
 * On the same line as its reflection in the room, because it is the same
 * lamp: a strip the slab returns from one direction while being lit from
 * another is two lamps, and the picture stops adding up. Far longer than the
 * slab is wide. A strip lamp has ends, and an end that lands on the face reads
 * as a scratch rather than as a reflection — so both of them stay outside the
 * picture at every angle the slab can reach. Leaned by the same angle as its
 * reflection in the room.
 */
const STRIP = { at: { x: -0.5, y: 0.46, z: 3.4 }, width: 16, height: 0.4 } as const;

/** Every lamp a color's slab is lit by: the key, the fill, and the strip. */
const slabLights = (theme: Theme): readonly Light[] => [
  {
    _tag: "Directional",
    color: SLAB_KEY.color,
    intensity: SLAB_ROOM[theme].key,
    at: SLAB_KEY.at,
    shadow: Option.some(SLAB_KEY.shadow),
  },
  fill(SLAB_ROOM[theme].fill),
  {
    _tag: "RectArea",
    color: LAMP_COLOR,
    intensity: SLAB_ROOM[theme].strip,
    at: STRIP.at,
    aimedAt: ORIGIN,
    width: STRIP.width,
    height: STRIP.height,
    lean: STRIP_LEAN,
  },
];

/**
 * Every lamp in a scene, in the order they hang.
 *
 * The one thing either corner does that the other does not: a roughness room's
 * ring travels with the pointer, because a grain is read from a highlight
 * moving over a surface, and a coated room's ring stays where it rests. Where
 * the lamps stand at rest, and everything else about them, is the same in
 * both.
 */
export const lights = ({ theme, view }: SceneInput): readonly Light[] =>
  match(view)
    .with({ _tag: "Color" }, () => slabLights(theme))
    .with({ _tag: "Roughness" }, (rough) =>
      cornerLights(
        theme,
        rough,
        rough.lamps.map((lamp) => lamp.at),
      ),
    )
    .with({ _tag: "Coating" }, (coat) =>
      cornerLights(theme, coat, ringAt(RING_LAMPS, RING_AT_REST, LAMP_RADIUS)),
    )
    .with({ _tag: "Emission" }, (glow) => openLights(theme, glow))
    .exhaustive();

/* ------------------------------------------------------------------ the air */

/**
 * Where the floor of the open room begins to fade, and where it has gone.
 *
 * The far end is inside the nearest the floor's own edge can come to the eye,
 * whichever way the eye has walked around it, so the floor has faded into the
 * color of the room before it stops. A floor that stops inside the picture is
 * a disc lying in the dark; one that fades has no end in the picture at all.
 * Both the floor and the wall behind it go, and they go to the same color, so
 * there is no seam anywhere for an eye to find the end of the room at.
 */
export const OPEN_FOG: Fog = {
  near: EYE_RADIUS,
  far: (OPEN_RADIUS - EYE_RADIUS) * 0.9,
};

/**
 * The open room's haze seen from `viewpoint`.
 *
 * `OPEN_FOG` at rest. A haze is measured from the eye, so an eye that stands
 * back takes the haze back with it by as far as it stepped, and the subjects
 * fade no more than they do from where it rests.
 */
const hazeAt = (viewpoint: Viewpoint): Fog => {
  const back = EYE_RADIUS * (distanceAt(FIELD_OF_VIEW.Emission, viewpoint) - 1);

  return { near: OPEN_FOG.near + back, far: OPEN_FOG.far + back };
};

/** The haze that closes a scene, if it has one: only the open room does. */
export const fog = ({ view }: SceneInput): Option<Fog> =>
  match(view)
    .with({ _tag: "Emission" }, ({ viewpoint }) => Option.some(hazeAt(viewpoint)))
    .otherwise(() => Option.none);

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

/**
 * How a spill is read against the room it lands in, under each theme: how far
 * the threshold it starts above is lifted, in linear light, and what its
 * strength is scaled by.
 *
 * By day the open room's spill starts well above the room's own surfaces, so
 * the bright wall and floor never spill along with the subjects, and it is
 * drawn weaker: against a lit floor a full spill is a soft copy of the subject
 * laid over the subject, which reads as the picture being out of focus, and a
 * rim of it around each face is what reads as light leaving the face. At
 * night, against a dark room, a spill is light in the air, and it is drawn
 * whole.
 */
const OPEN_SPILL: Readonly<Record<Theme, Readonly<{ from: number; share: number }>>> = {
  light: { from: 1.8, share: 0.35 },
  dark: { from: 0, share: 1 },
};

/**
 * How far a color's spill is drawn, as a multiple of what its finish asks for.
 *
 * Small on purpose: a spill is the display admitting it has run out of range,
 * and one big enough to reach the wall says instead that the room is that
 * color.
 */
const SLAB_SPILL = 0.35;

/**
 * What the bloom pass makes of a scene.
 *
 * Nothing in either corner spills. A roughness room's lamps move, and a spill
 * that travels with a highlight turns a demonstration of a surface into a
 * light show — which is the one thing a shopper comparing two roughnesses
 * cannot see past; and nothing in a coated room is over the threshold, because
 * interference moves light between wavelengths rather than adding any.
 */
export const bloom = ({ theme, view }: SceneInput): Bloom =>
  match(view)
    .with({ _tag: "Color" }, ({ finishing }): Bloom => {
      const surface = surfaceFor(finishing);

      return {
        strength: surface.bloom.strength * SLAB_SPILL,
        threshold: surface.bloom.threshold,
      };
    })
    .with({ _tag: "Emission" }, ({ emission }): Bloom => {
      const glow = glowFraction(emission);

      return {
        strength: GLOW_BLOOM * glow ** GLOW_BLOOM_CURVE * OPEN_SPILL[theme].share,
        threshold: between(GLOW_BLOOM_FROM, glow) + OPEN_SPILL[theme].from,
      };
    })
    .with(
      { _tag: P.union("Roughness", "Coating") },
      (corner): Bloom => ({
        strength: 0,
        threshold: surfaceFor(finishingOf(corner)).bloom.threshold,
      }),
    )
    .exhaustive();

/**
 * The light in a room's air, and what is beyond it: its walls with no lamp on
 * them, so a dim room fades into the dark instead of ending against a lit wall.
 */
const roomAir = (theme: Theme, view: FinisherView, walls: Rgb): Air => {
  const ambient = ambientOf(theme, view);

  return { environment: ambient, clear: { paint: walls, level: ambient } };
};

/** The light in a scene's air, and what is beyond it. */
export const air = ({ theme, view }: SceneInput): Air =>
  match(view)
    .with(
      { _tag: "Color" },
      (): Air => ({
        environment: SLAB_ROOM[theme].environment,
        clear: { paint: SLAB_WALL[theme], level: 1 },
      }),
    )
    .with({ _tag: "Emission" }, (room) => roomAir(theme, room, OPEN_PAINT[theme].walls))
    .with({ _tag: P.union("Roughness", "Coating") }, (room) =>
      roomAir(theme, room, CORNER_PAINT[theme].walls),
    )
    .exhaustive();

/* ---------------------------------------------------------------- the scene */

/** Everything one picture is made of, for what it shows under the theme it is shown in. */
export const scene = (input: SceneInput): Scene => ({
  shell: shell(input),
  subjects: subjects(input),
  lights: lights(input),
  camera: camera(input),
  fog: fog(input),
  bloom: bloom(input),
  air: air(input),
});
