/**
 * A finisher, as a room with the effect demonstrated in it.
 *
 * Three rooms, one per thing a finisher can do to a surface, and each is built
 * once and kept. Every number that differs between two finishers in the same
 * room comes out of `roomFor`, which takes the finisher's one amount and
 * nothing else — so a room is a picture of the amount the shopper is buying,
 * and two finishers a point apart are lit and painted a point apart. What does
 * not differ is the room: the same shapes stand in the same places at the same
 * sizes for every finisher shown in it. Nothing in here looks at a finisher's
 * name.
 *
 * What the pointer does differs by room, because what is worth seeing differs:
 * a roughness is read from how a highlight travels, a glow from moving around
 * it in the dark, and a coating from the angle light leaves it at. The
 * movement is carried in the view rather than kept here, so a stage that
 * nobody is pointing at costs one draw and then nothing.
 *
 * This and `scene.ts` sit on `gl.ts`, which owns the one context there is.
 * Like it, nothing here is re-entrant: there is one of each room and one
 * subject in it per place, so a second call while one is running would put the
 * first stage's finisher on the second stage's canvas.
 */

import { Option, type Rgb } from "@prism/shared";
import {
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  SRGBColorSpace,
  type Texture,
} from "three";
import { match } from "ts-pattern";
import type { Theme } from "../../../shared/theme/use-theme.ts";
import {
  COATED_HUES,
  CORNER_BEARING,
  GLOWING_HUES,
  type Placement,
  RESTING_TILT,
  restingOf,
  STANDING_IN,
} from "./arrangement.ts";
import { BARE_PIGMENT, roomFor, type FinisherRoom } from "./finishers.ts";
import {
  type Frame,
  MINIMUM_FEATURE,
  openStage as openGlStage,
  type Stage as GlStage,
  studio,
  type Studio,
  themeNow,
} from "./gl.ts";
import { hueShifted } from "./hueshift.ts";
import { LAGS, type Lamp, ringAt } from "./lightring.ts";
import { meshNow } from "./mesh.ts";
import { type Eye, eyeAt, type Orbit } from "./orbit.ts";
import { pairedWith } from "./pairs.ts";
import {
  CORNER_GAZE,
  EYE_HEIGHT,
  EYE_RADIUS,
  FIELD_OF_VIEW,
  GLOW_TARGET,
  hazeAt,
  LAMP_RADIUS,
  OPEN_FOG,
  OPEN_ROOM,
  REACH,
  RING_AT_REST,
  ROOM_EXTENT,
  WALL_AT,
} from "./rooms.ts";
import { COATING_IOR, emissiveScale, excite, type Surface } from "./surfaces.ts";
import { fieldOfViewAt, type Gaze, lookFrom, type Viewpoint } from "./viewpoint.ts";

/* ---------------------------------------------------------------- the finish */

/** Matte, so the room shows the light falling on it and not a reflection of it. */
const ROOM_ROUGHNESS = 0.95;

/**
 * How one room is painted and lit, under one of the two themes the shop wears.
 *
 * A room is looked at through the page it is on, and the page is either bright
 * or dark. The same room dressed the same way reads differently against the
 * two: a wall mixed to sit inside a bright page is a lamp in a dark one, and a
 * room lit to be read against white is flat against black. So each room keeps
 * two of these and picks by the theme in force when it is drawn.
 */
type Dressing = Readonly<{
  /** What the floor and every wall are painted. */
  paint: number;
  /** What the room's own light level is worth here, as a multiple of it. */
  light: number;
  /** How much sky and bounce the ambient light carries, as a multiple of `ambient`. */
  fill: number;
  /**
   * How much of the room's light level arrives from everywhere at once, as a
   * multiple of it.
   *
   * That is the surroundings every surface reflects, the sky and bounce that
   * `fill` sets, and the paint the room fades into beyond its lamps. The
   * lamps are not part of it.
   */
  ambient: number;
  /**
   * How high the room's own surfaces sit, in linear light.
   *
   * What the threshold a spill starts above is lifted by, so the spill is
   * always measured against the room it is spilling into. Without it a room
   * painted for a bright page is itself over the threshold, and every pixel of
   * floor and wall spills along with the subject.
   */
  spillFrom: number;
}>;

/** The two dressings a room keeps, one per theme. */
type Dressings = Record<Theme, Dressing>;

/** What a corner's walls are painted, under each theme. */
const CORNER_PAINT: Record<Theme, number> = { light: 0x9c9c9c, dark: 0x3a3a3a };

/**
 * How a corner is dressed, whichever of the two is being looked at.
 *
 * One dressing, so the two corners are one room. The lamps are turned up under
 * the dark theme, because a corner has no light in it but what its own lamps
 * put there and dark paint returns little of that to the shadowed side of
 * anything. The fill is held well under the lamps under both: it opens the
 * side of a subject every lamp is turned away from, and light arriving from
 * everywhere at once fills the shadows on the floor in with it.
 */
const CORNER_DRESSING: Dressings = {
  light: {
    paint: CORNER_PAINT.light,
    light: 0.66,
    fill: 0.25,
    ambient: 1,
    spillFrom: 0.6,
  },
  dark: { paint: CORNER_PAINT.dark, light: 1.25, fill: 0.3, ambient: 1, spillFrom: 0.15 },
};

/**
 * How the open room a glow is demonstrated in is dressed.
 *
 * Its two paints are far closer together than a corner's. What that floor is
 * for is catching the light coming off the subjects standing on it, and the
 * pool it catches is the whole of what says the light is leaving them; a floor
 * painted as dark as the shop's dark walls catches almost none of it, and the
 * demonstration goes with it. The dark room is the dimmer of the two all the
 * same: a page that is already dark asks less of a room for its glow to be the
 * brightest thing on it.
 *
 * The dark room holds its ambient well under its lamps. Light arriving from
 * everywhere at once lights every side of a subject alike, and a subject lit
 * on every side reads as a painted object that also glows rather than as a
 * light in a dark room. The lamps still shade the subjects, and the glow still
 * lays its pools on the floor.
 */
const OPEN_DRESSING: Dressings = {
  light: { paint: 0xb0b0b0, light: 0.95, fill: 0.8, ambient: 1, spillFrom: 0.55 },
  dark: { paint: 0x5a5a5a, light: 0.6, fill: 0.5, ambient: 0.35, spillFrom: 0 },
};

/** How many lamps hang on a corner's ring. */
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
 * The squared radius is there because light falls off with the square of how
 * far it has traveled, which is what makes `RING_POWER` a measure of the light
 * that arrives rather than of the light that leaves.
 */
const RING_LIGHT = RING_POWER * LAMP_RADIUS ** 2;

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
 * What a glowing subject puts into the air around it, per unit of its own glow.
 *
 * A fluorescent face is a light source, and a renderer that only draws it
 * bright shows a picture of one rather than one. This is the pool it lays on
 * the floor under itself, which is what says the light is leaving the surface.
 */
const GLOW_LAMP = 1.3;

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

/** How saturated and how light a demonstration pigment is mixed. */
type Pigment = Readonly<{ saturation: number; lightness: number }>;

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

/* ------------------------------------------------------------ the subjects */

/** One shape lying in a room, and the paint on it. */
type Subject = Readonly<{ mesh: Mesh; pigment: MeshPhysicalMaterial }>;

/** A subject in the open room, which is a lamp as well as a surface. */
type Lit = Subject & Readonly<{ glow: SpotLight }>;

/**
 * The paint one subject wears.
 *
 * Every shader feature it can use is switched on permanently, with values that
 * go to nearly nothing rather than to zero, for the same reason the slab's
 * material does: three keys its programs on which features are above zero, and
 * a room whose subjects turned one off between two finishers would compile a
 * second shader mid-scroll.
 *
 * No grain maps, unlike the slab: the vendored mesh carries no UVs, so there
 * is nothing for a texture to be laid along.
 */
const buildPigment = (environment: Texture): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({
    color: 0xffffff,
    // Placeholders, all of them overwritten per finisher. What matters here is
    // only that none of them is zero.
    roughness: 0.5,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.55,
    sheenColor: 0xffffff,
    clearcoat: 0.5,
    clearcoatRoughness: 0.05,
    iridescence: 0.5,
    iridescenceIOR: COATING_IOR,
    // One layer, one thickness — so both ends of the range are the same number
    // and no map is needed to vary it across a face.
    iridescenceThicknessRange: [300, 300],
    envMap: environment,
    envMapIntensity: 1,
    emissiveIntensity: 1,
  });

/** How far the subjects of a room are lifted, and how far each of them reaches. */
type Kit = Readonly<{
  environment: Texture;
  geometry: BufferGeometry;
  /** How far a subject at full size drops below its own middle, lying back. */
  drop: number;
}>;

/**
 * Stand the subjects of one room where the arrangement says.
 *
 * Once, at build: the arrangement is the room's own and does not change from
 * one finisher to the next, so nothing about how a subject is standing is
 * touched again after this.
 */
const buildSubjects = (
  scene: Scene,
  kit: Kit,
  standing: readonly Placement[],
  casts: boolean,
): readonly Subject[] =>
  standing.map((at): Subject => {
    const pigment = buildPigment(kit.environment);
    const mesh = new Mesh(kit.geometry, pigment);

    mesh.castShadow = casts;
    // Tilted about its own left-right axis first and turned about the room's
    // vertical axis second, which is what `YXZ` orders. The other way round
    // every subject falls the same way across the floor whichever way it is
    // facing; this way each of them falls onto its own back.
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(RESTING_TILT, at.turn, 0);
    mesh.position.set(at.x, at.scale * kit.drop, at.z);
    mesh.scale.setScalar(at.scale);
    scene.add(mesh);

    return { mesh, pigment };
  });

/* ---------------------------------------------------------------- the room */

/** What every finisher's room has, whatever is being demonstrated in it. */
type Room = Readonly<{
  scene: Scene;
  camera: PerspectiveCamera;
  /** The lens the room is seen through at rest, in degrees. */
  fieldOfView: number;
  subjects: readonly Subject[];
  /** The floor and any walls, held so the room can be repainted with the theme. */
  paint: MeshStandardMaterial;
  /** How the room is painted and lit, under each theme. */
  dressings: Dressings;
  /** Sky and bounce, so a face turned away from every lamp still has a shape. */
  fill: HemisphereLight;
  /** What is behind the room, held so it is mixed once rather than per frame. */
  clear: Color;
}>;

/**
 * The shape of the surfaces one room is built out of.
 *
 * A corner is a floor and the two walls that meet behind it, and everything
 * about it follows from how far back those walls stand. A drum is a round
 * floor with one wall all the way around it, far enough out to stay dark —
 * which is what a demonstration of light coming out of a surface needs, since
 * a wall near enough to be lit is a wall that reports the glow instead of the
 * subject.
 */
type Shell =
  | Readonly<{ _tag: "Corner"; wallAt: number }>
  | Readonly<{ _tag: "Drum"; radius: number; height: number }>;

/** How far the eye can see in a room, which is where its camera is clipped. */
const farOf = (shell: Shell): number =>
  match(shell)
    .with({ _tag: "Corner" }, ({ wallAt }) => wallAt * ROOM_EXTENT * 2)
    .with({ _tag: "Drum" }, ({ radius }) => (radius + EYE_RADIUS) * 2)
    .exhaustive();

/** Lay the floor and raise whatever wall this room has. */
const buildShell = (scene: Scene, shell: Shell): MeshStandardMaterial => {
  const paint = new MeshStandardMaterial({
    roughness: ROOM_ROUGHNESS,
    metalness: 0,
  });

  const surface = (geometry: CircleGeometry | CylinderGeometry | PlaneGeometry): Mesh => {
    const face = new Mesh(geometry, paint);
    face.receiveShadow = true;
    scene.add(face);

    return face;
  };

  match(shell)
    .with({ _tag: "Corner" }, ({ wallAt }) => {
      const extent = wallAt * ROOM_EXTENT;

      surface(new PlaneGeometry(extent, extent)).rotation.x = -Math.PI / 2;

      // Centered half an extent up, so the bottom edge of each wall is exactly
      // the floor and the top is far outside the frame.
      const back = surface(new PlaneGeometry(extent, extent));
      back.position.set(0, extent / 2, -wallAt);

      const side = surface(new PlaneGeometry(extent, extent));
      side.position.set(-wallAt, extent / 2, 0);
      side.rotation.y = Math.PI / 2;
    })
    .with({ _tag: "Drum" }, ({ radius, height }) => {
      // Seen from inside, both of them: the eye stands on this floor rather
      // than looking down onto it.
      paint.side = DoubleSide;

      surface(new CircleGeometry(radius, 64)).rotation.x = -Math.PI / 2;
      surface(new CylinderGeometry(radius, radius, height, 64, 1, true)).position.y =
        height / 2;
    })
    .exhaustive();

  return paint;
};

/**
 * Stand a room's eye at a viewpoint around where it rests, where `lookFrom`
 * puts it, and see through the viewpoint's lens.
 */
const standEye = (room: Room, gaze: Gaze, viewpoint: Viewpoint): void => {
  const look = lookFrom(gaze, viewpoint, room.fieldOfView);

  room.camera.position.set(look.eye.x, look.eye.y, look.eye.z);
  room.camera.lookAt(look.target.x, look.target.y, look.target.z);
  room.camera.fov = fieldOfViewAt(room.fieldOfView, viewpoint);
  room.camera.updateProjectionMatrix();
};

/** Everything a room is, before anything is demonstrated in it. */
type RoomPlan = Readonly<{
  standing: readonly Placement[];
  shell: Shell;
  dressings: Dressings;
  fieldOfView: number;
  casts: boolean;
}>;

const buildRoom = (kit: Kit, plan: RoomPlan): Room => {
  const scene = new Scene();
  scene.environment = kit.environment;

  // Sky above, bounce below, and no highlight of its own: a hemisphere light
  // contributes irradiance only, so it fills the shadows without adding a
  // second reflection for a finish to be read from by mistake.
  const fill = new HemisphereLight(0xeff3fb, 0xcdc8c1);
  scene.add(fill);

  return {
    scene,
    camera: new PerspectiveCamera(plan.fieldOfView, 1, 0.1, farOf(plan.shell)),
    fieldOfView: plan.fieldOfView,
    subjects: buildSubjects(scene, kit, plan.standing, plan.casts),
    paint: buildShell(scene, plan.shell),
    dressings: plan.dressings,
    fill,
    clear: new Color(),
  };
};

/** What a dressed room hands the rest of the frame. */
type Dressed = Readonly<{
  /** What every lamp in the room is scaled by. */
  light: number;
  /** What the threshold the room's spill starts above is lifted by. */
  spillFrom: number;
}>;

/**
 * Paint the room, set how much light is in its air, and say how bright it is.
 *
 * What it hands back is what the rest of the frame is measured in, so a room
 * dressed dark for a dark page is dark all the way through rather than dark
 * walls under lamps and a spill set for the other theme.
 */
const dressRoom = (room: Room, finish: FinisherRoom): Dressed => {
  const dressing = room.dressings[themeNow()];
  const light = finish.light * dressing.light;
  const ambient = dressing.ambient * light;

  room.paint.color.setHex(dressing.paint, SRGBColorSpace);
  room.scene.environmentIntensity = ambient;
  room.fill.intensity = dressing.fill * ambient;
  // What is beyond the room is the room's own paint with no lamp on it, so a
  // dim room fades into the dark instead of ending against a lit wall.
  room.clear.setHex(dressing.paint, SRGBColorSpace).multiplyScalar(Math.min(1, ambient));

  return { light, spillFrom: dressing.spillFrom };
};

/* ------------------------------------------------------------- the pigment */

/** Set a material color from a pigment measured out of 255 per channel. */
const paintRgb = (color: Color, rgb: Rgb): void => {
  color.setRGB(rgb.red / 255, rgb.green / 255, rgb.blue / 255, SRGBColorSpace);
};

/** Read a material color back as a pigment out of 255 per channel. */
const rgbOf = (color: Color): Rgb => {
  const packed = color.getHex(SRGBColorSpace);

  return { red: (packed >> 16) & 0xff, green: (packed >> 8) & 0xff, blue: packed & 0xff };
};

/** Mix a demonstration pigment at one place on the wheel. */
const paintHue = (color: Color, hue: number, pigment: Pigment): void => {
  color.setHSL(hue / 360, pigment.saturation, pigment.lightness, SRGBColorSpace);
};

/**
 * Put a surface on a subject.
 *
 * Every parameter comes from `surfaceFor` by way of `roomFor`, so a finisher
 * that leaves a surface at some number and a color already at that number are
 * the same material. `relief` has nowhere to go: the mesh carries no UVs.
 */
const applySurface = (pigment: MeshPhysicalMaterial, surface: Surface): void => {
  pigment.roughness = surface.roughness;
  pigment.metalness = surface.metalness;
  pigment.sheen = Math.max(surface.sheen, MINIMUM_FEATURE);
  pigment.clearcoat = Math.max(surface.clearcoat, MINIMUM_FEATURE);
  pigment.clearcoatRoughness = surface.clearcoatRoughness;
  pigment.iridescence = surface.iridescence;
  pigment.envMapIntensity = surface.envIntensity;
  // Both ends the same: a coating is one layer of one thickness, and what
  // color it shows follows from that number and the angle it is seen at.
  pigment.iridescenceThicknessRange = [
    surface.coatingNanometers,
    surface.coatingNanometers,
  ];
};

/**
 * Have a lamp draw its shadow once, and keep it.
 *
 * Every shadow in these rooms depends on how the subjects are lying and on the
 * lamp laying it, and neither of those ever moves — so the map is rendered on
 * the first frame that wants it and kept for the life of the document, however
 * many stages are drawn from it afterward. `softness` is how far the edge of
 * what the lamp lays is spread, in map texels.
 */
const castsOnce = (lamp: DirectionalLight | SpotLight, softness: number): void => {
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  // Soft enough to read as the subject lying on the floor rather than as a
  // second dark shape beside it.
  lamp.shadow.radius = softness;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.normalBias = 0.03;
  lamp.shadow.autoUpdate = false;
  lamp.shadow.needsUpdate = true;
};

/** Where one lamp stands, in world units. */
type Standing = readonly [number, number, number];

/**
 * Stand a lamp in a room, aimed at the middle of its floor, casting once.
 *
 * `extent` is how far from that middle the lamp's shadow map has to reach and
 * `softness` how far the edge of what it lays is spread.
 */
const standLamp = (
  room: Room,
  color: number,
  at: Standing,
  extent: number,
  softness: number,
): DirectionalLight => {
  const lamp = new DirectionalLight(color);

  lamp.position.set(at[0], at[1], at[2]);
  lamp.shadow.camera.left = -extent;
  lamp.shadow.camera.right = extent;
  lamp.shadow.camera.top = extent;
  lamp.shadow.camera.bottom = -extent;
  lamp.shadow.camera.far = 24;
  castsOnce(lamp, softness);
  room.scene.add(lamp);

  return lamp;
};

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

/**
 * How far the edge of each of the open room's two shadows is spread, in texels.
 *
 * The first lamp is the one the eye reads as the light in the room, and the
 * shadow it lays is what puts a subject on the floor. The second stands wider
 * and lays a shadow spread far enough that it reads as the room's own light
 * failing to reach behind something rather than as a second object.
 */
const OPEN_SOFTNESS = { key: 6, side: 13 } as const;

/**
 * How far the edge of a cone lamp's light is carried in toward its own axis.
 *
 * All the way, which is the most a cone can be softened. A cone with any edge
 * left on it lays a disc of light with a rim, and a rim on a wall reads as a
 * second object standing in the room rather than as the room being lit.
 */
const CONE_SOFTNESS = 1;

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
 * Hang a cone lamp in a room, aimed at a fixed point in it.
 *
 * `spread` is the half-angle of the cone in radians. The lamp starts dark: how
 * bright it is belongs to the finisher being demonstrated and is set per
 * frame. Aiming is by a target object of its own, so a lamp that travels keeps
 * pointing at the same place without anything having to turn it.
 */
const coneLamp = (
  room: Room,
  color: number,
  aimedAt: Standing,
  spread: number,
): SpotLight => {
  const lamp = new SpotLight(color, 0, 0, spread, CONE_SOFTNESS);

  lamp.target.position.set(aimedAt[0], aimedAt[1], aimedAt[2]);
  room.scene.add(lamp.target);
  room.scene.add(lamp);

  return lamp;
};

/** The middle of a room's floor, which is what its ring of lamps is aimed at. */
const ROOM_MIDDLE: Standing = [0, 0, 0];

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

/**
 * How far the edge of what a casting lamp lays is spread, in shadow map texels.
 *
 * Little. A shadow is told apart from the floor around it by its edge, and an
 * edge spread wider than the step it makes reads as the floor darkening toward
 * one side rather than as a shape lying on it.
 */
const CASTER_SOFTNESS = 2;

/** What every lamp in a corner burns: white, so the lamps add no color of their own. */
const LAMP_COLOR = 0xffffff;

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
 * The squared distance is there for the same reason it is in `RING_LIGHT`.
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
 * Hang one of a corner's casting lamps, aimed at the middle of the floor.
 *
 * Its shadow is drawn once, the first time the room is.
 */
const castingLamp = (room: Room, caster: Caster): SpotLight => {
  const lamp = coneLamp(room, LAMP_COLOR, ROOM_MIDDLE, CASTER_SPREAD);
  const at = eyeAt(
    { azimuth: CORNER_BEARING + caster.around, elevation: caster.elevation },
    CASTER_REACH,
  );

  lamp.position.set(at.x, at.y, at.z);
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = CASTER_REACH + WALL_AT * 2;
  castsOnce(lamp, CASTER_SOFTNESS);

  return lamp;
};

/** One of the lamps a corner washes a wall with. */
type Wash = Readonly<{
  /** Where it hangs. */
  at: Standing;
  /** The point on the wall its cone is built around. */
  aimedAt: Standing;
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
  { at: [-1.5, 1.55, -WALL_AT + 0.4], aimedAt: [-1.5, 0, -WALL_AT] },
  { at: [-WALL_AT + 0.4, 1.55, -1.5], aimedAt: [-WALL_AT, 0, -1.5] },
];

/** How bright one of a corner's wall lamps is, in candela. */
const WASH_LIGHT = 5;

/** How wide open a wall lamp is, as a half-angle in radians. */
const WASH_SPREAD = Math.PI / 3.6;

/** Every lamp a corner is lit by. */
type Corner = Readonly<{
  /** The three that cast, in the order `CORNER_CASTERS` names them. */
  casters: readonly SpotLight[];
  /** The two that light the walls, in the order `CORNER_WASHES` names them. */
  washes: readonly SpotLight[];
  /** The ring, which one corner turns with the pointer and the other does not. */
  ring: readonly SpotLight[];
}>;

/**
 * Light a corner.
 *
 * Every corner is lit by this and by nothing else, off constants that name no
 * room: the two corners are the same room with different things standing in
 * it, and a shopper moving from one shelf to the other is meant to see the
 * finish change and nothing else.
 */
const litCorner = (room: Room): Corner => ({
  casters: CORNER_CASTERS.map((caster) => castingLamp(room, caster)),
  washes: CORNER_WASHES.map((wash) => {
    const lamp = coneLamp(room, LAMP_COLOR, wash.aimedAt, WASH_SPREAD);

    lamp.position.set(wash.at[0], wash.at[1], wash.at[2]);

    return lamp;
  }),
  ring: ringAt(RING_LAMPS, RING_AT_REST, LAMP_RADIUS).map((at) => {
    const lamp = coneLamp(room, LAMP_COLOR, ROOM_MIDDLE, RING_SPREAD);

    lamp.position.set(at.x, at.y, at.z);

    return lamp;
  }),
});

/**
 * Turn every lamp in a corner up to what the room it is lighting is worth.
 *
 * `light` is the room's own light level, which is the finisher's crossed with
 * the theme's. Both corners are turned up by this and by nothing else.
 */
const lightCorner = (corner: Corner, light: number): void => {
  for (const lamp of corner.casters) lamp.intensity = CASTER_LIGHT * light;
  for (const lamp of corner.washes) lamp.intensity = WASH_LIGHT * light;
  for (const lamp of corner.ring) lamp.intensity = RING_LIGHT * light;
};

/* ------------------------------------------------------- the roughness room */

/** A roughness room: a gray subject in a lit corner, under a ring that travels. */
type Rough = Readonly<{ room: Room; corner: Corner; gaze: Gaze }>;

const buildRough = (kit: Kit): Rough => {
  const room = buildRoom(kit, {
    standing: STANDING_IN.roughness,
    shell: { _tag: "Corner", wallAt: WALL_AT },
    dressings: CORNER_DRESSING,
    fieldOfView: FIELD_OF_VIEW.roughness,
    casts: true,
  });

  return { room, corner: litCorner(room), gaze: CORNER_GAZE.roughness };
};

/* ------------------------------------------------------------- the open room */

/** An open room: three glowing subjects, on a round floor with one far wall. */
type Glow = Readonly<{
  room: Room;
  lit: readonly Lit[];
  /** Fixed, high and to one side, and what gives the subjects their shading. */
  key: DirectionalLight;
  /** Fixed, lower and across the floor from it, and what lays the second shadow. */
  side: DirectionalLight;
  /** What closes the floor, held so it fades into whatever the room is painted. */
  haze: Fog;
}>;

const buildGlow = (kit: Kit): Glow => {
  const room = buildRoom(kit, {
    standing: STANDING_IN.emission,
    shell: { _tag: "Drum", radius: OPEN_ROOM.radius, height: OPEN_ROOM.height },
    dressings: OPEN_DRESSING,
    fieldOfView: FIELD_OF_VIEW.emission,
    casts: true,
  });

  room.camera.lookAt(0, EYE_HEIGHT.emission.looksAt, 0);

  const key = standLamp(
    room,
    0xfff6ec,
    [2.1, 3.4, 2.4],
    REACH.emission * 1.3,
    OPEN_SOFTNESS.key,
  );
  const side = standLamp(
    room,
    0xe6eeff,
    [-2.6, 1.9, -1.8],
    REACH.emission * 1.7,
    OPEN_SOFTNESS.side,
  );

  // Both the floor and the wall behind it go, and they go to the same color,
  // so there is no seam anywhere for an eye to find the end of the room at.
  const haze = new Fog(0, OPEN_FOG.near, OPEN_FOG.far);
  room.scene.fog = haze;

  const lit = pairedWith(room.subjects, STANDING_IN.emission).map(
    ([subject, at]): Lit => {
      // Aimed straight down at the floor it is standing on, from inside the
      // shape it belongs to — which is where the light it stands for comes
      // from, and the floor is where that light is seen arriving.
      const glow = coneLamp(room, 0xffffff, [at.x, 0, at.z], POOL_SPREAD);

      glow.position.set(at.x, at.scale * kit.drop, at.z);

      return { ...subject, glow };
    },
  );

  return { room, lit, key, side, haze };
};

/* --------------------------------------------------------- the coating room */

/** A coating room: two coated subjects in the same corner, lit the same way. */
type Coat = Readonly<{ room: Room; corner: Corner; gaze: Gaze }>;

const buildCoat = (kit: Kit): Coat => {
  const room = buildRoom(kit, {
    standing: STANDING_IN.coating,
    shell: { _tag: "Corner", wallAt: WALL_AT },
    dressings: CORNER_DRESSING,
    fieldOfView: FIELD_OF_VIEW.coating,
    casts: true,
  });

  return { room, corner: litCorner(room), gaze: CORNER_GAZE.coating };
};

/* ----------------------------------------------------------------- the rig */

/** The three rooms, built together and kept for the life of the document. */
type Rig = Readonly<{ rough: Rough; glow: Glow; coat: Coat }>;

const buildRig = ({ environment }: Studio, geometry: BufferGeometry): Rig => {
  const kit: Kit = {
    environment,
    geometry,
    drop: restingOf(geometry.getAttribute("position").array, RESTING_TILT).drop,
  };

  return { rough: buildRough(kit), glow: buildGlow(kit), coat: buildCoat(kit) };
};

/**
 * The rooms, built the first time there is both a context and a mesh.
 *
 * Retried rather than attempted once, because the mesh arrives over the
 * network: a stage that opens before it lands draws its still picture and asks
 * again on the frame after it arrives.
 */
let theRig: Option<Rig> = Option.none;

const rigNow = (): Option<Rig> => {
  if (Option.isNone(theRig)) {
    theRig = Option.flatMap((open: Studio) =>
      Option.map((geometry: BufferGeometry) => buildRig(open, geometry))(meshNow()),
    )(studio());
  }

  return theRig;
};

/* -------------------------------------------------------------- the stages */

/** A roughness finisher's picture: its amount and its lamps. */
export type RoughnessView = Readonly<{
  applies: "roughness";
  /** 5 is a mirror, 95 is chalk. */
  roughness: number;
  /** Where the four lamps have got to, as `lightring` has moved them. */
  lamps: readonly Lamp[];
  /** Where the room is looked at from. */
  viewpoint: Viewpoint;
}>;

/** A fluorescent finisher's picture: its amount and its eye. */
export type EmissionView = Readonly<{
  applies: "emission";
  /** How hard the pigment gives off its own light, out of 100. */
  emission: number;
  /** Where the eye has got to, as `orbit` has moved it. */
  orbit: Orbit;
  /** Where the room is looked at from, around wherever the orbit has put the eye. */
  viewpoint: Viewpoint;
}>;

/** A coating finisher's picture: its amount and its hue. */
export type CoatingView = Readonly<{
  applies: "coating";
  /** Nanometers of interference coating. */
  coatingNanometers: number;
  /** How far around the wheel every subject's hue has been carried. */
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

/** A canvas the renderer has agreed to keep painting a finisher's room onto. */
export type Stage = GlStage<FinisherView>;

/** The frame a room hands back once it has been dressed. */
const frameOf = (room: Room, finish: FinisherRoom, dressed: Dressed): Frame => ({
  scene: room.scene,
  camera: room.camera,
  bloom: {
    strength: finish.bloom.strength,
    threshold: finish.bloom.threshold + dressed.spillFrom,
  },
  clear: room.clear,
});

const roughFrame = (rig: Rough, view: RoughnessView): Frame => {
  const finish = roomFor(view);
  const dressed = dressRoom(rig.room, finish);
  const light = dressed.light;

  for (const subject of rig.room.subjects) {
    // The one neutral every finisher is shown on, since none has a color.
    subject.pigment.color.setStyle(BARE_PIGMENT, SRGBColorSpace);
    applySurface(subject.pigment, finish.surface);
  }

  lightCorner(rig.corner, light);
  standEye(rig.room, rig.gaze, view.viewpoint);

  // The one thing either corner does that the other does not: its ring travels
  // with the pointer, because a grain is read from a highlight moving over a
  // surface. Where the lamps stand at rest, and everything else about them, is
  // the same in both.
  for (const [lamp, standing] of pairedWith(rig.corner.ring, view.lamps)) {
    lamp.position.set(standing.at.x, standing.at.y, standing.at.z);
  }

  return frameOf(rig.room, finish, dressed);
};

const glowFrame = (rig: Glow, view: EmissionView): Frame => {
  const finish = roomFor(view);
  const dressed = dressRoom(rig.room, finish);
  const light = dressed.light;

  rig.haze.color.copy(rig.room.clear);

  const haze = hazeAt(view.viewpoint);
  rig.haze.near = haze.near;
  rig.haze.far = haze.far;

  for (const [subject, hue] of pairedWith(rig.lit, GLOWING_HUES)) {
    // The paint the subject is mixed at, which is what the lamps in the room
    // light and shade. It is left alone from here: a fluorescent pigment is an
    // ordinary painted surface that also gives off light, and painting it the
    // color of its own glow leaves nothing for the light to fall on.
    paintHue(subject.pigment.color, hue, GLOWING_PIGMENT);

    // A fluorescent pigment absorbs in one band and hands it back in another,
    // returning nearly all of it — so what it gives off is its own hue at full
    // strength, whatever strength the paint itself was mixed at.
    const band = excite(rgbOf(subject.pigment.color));

    paintRgb(subject.pigment.emissive, band);
    subject.pigment.emissiveIntensity =
      GLOW_MIX * emissiveScale(finish.surface.emission, band);
    applySurface(subject.pigment, finish.surface);

    paintRgb(subject.glow.color, band);
    subject.glow.intensity = finish.surface.emission * GLOW_LAMP;
  }

  rig.key.intensity = GLOW_KEY * light;
  rig.side.intensity = GLOW_KEY * SIDE_SHARE * light;

  const orbiting = eyeAt(view.orbit, EYE_RADIUS);
  standEye(
    rig.room,
    {
      eye: { x: orbiting.x, y: GLOW_TARGET.y + orbiting.y, z: orbiting.z },
      target: GLOW_TARGET,
      pivot: GLOW_TARGET,
    },
    view.viewpoint,
  );

  return frameOf(rig.room, finish, dressed);
};

const coatFrame = (rig: Coat, view: CoatingView): Frame => {
  const finish = roomFor(view);
  const dressed = dressRoom(rig.room, finish);
  const light = dressed.light;

  for (const [subject, hue] of pairedWith(rig.room.subjects, COATED_HUES)) {
    // The same offset on every subject, so the two of them carry the interval
    // between their own hues around the wheel together.
    paintHue(subject.pigment.color, hueShifted(hue, view.hueOffset), COATED_PIGMENT);
    applySurface(subject.pigment, finish.surface);
  }

  lightCorner(rig.corner, light);
  standEye(rig.room, rig.gaze, view.viewpoint);

  return frameOf(rig.room, finish, dressed);
};

/**
 * Dress the room this finisher belongs in, and say what the frame is made of.
 *
 * Not re-entrant: it paints the one set of subjects each room has. `gl.ts`
 * calls it synchronously for that reason.
 */
const frameFor = (rig: Rig, view: FinisherView): Frame =>
  match(view)
    .with({ applies: "roughness" }, (rough) => roughFrame(rig.rough, rough))
    .with({ applies: "emission" }, (glow) => glowFrame(rig.glow, glow))
    .with({ applies: "coating" }, (coat) => coatFrame(rig.coat, coat))
    .exhaustive();

/**
 * Start painting a finisher's room onto a canvas, if there is one to paint.
 *
 * `None` means no WebGL2, a software rasterizer, or a mesh that has not
 * arrived — three answers the caller gives the same reply to, by showing the
 * still of the room that the shop already has.
 */
export const openStage = (canvas: HTMLCanvasElement): Option<Stage> =>
  Option.flatMap((rig: Rig) =>
    openGlStage<FinisherView>(canvas, (view) => frameFor(rig, view)),
  )(rigNow());
