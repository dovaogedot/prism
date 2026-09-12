/**
 * A color, as a slab standing in a lit room.
 *
 * One scene and one slab serve every color on the page: the stage under the
 * pointer paints the slab its own color, points it at its own angle and hands
 * `gl.ts` the frame, and the rest are still pictures of the last time their
 * turn came. That is why nothing in here is re-entrant, and why the material
 * has every shader feature it can use switched on permanently.
 *
 * Everything it decides comes from `surfaces.ts` and `tilt.ts`, which are pure.
 */

import { Option, parseHex, toRgb, type Rgb } from "@prism/shared";
import {
  DirectionalLight,
  ExtrudeGeometry,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RectAreaLight,
  Scene,
  Shape,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { Theme } from "../../../shared/theme/use-theme.ts";
import {
  type Frame,
  MINIMUM_FEATURE,
  openStage as openGlStage,
  type Stage as GlStage,
  studio,
  type Studio,
  themeNow,
} from "./gl.ts";
import { STRIP_LEAN } from "./room.ts";
import { FIELD_OF_VIEW, SLAB_GAZE, WALL_DISTANCE, WALL_SIZE } from "./slab-framing.ts";
import {
  emissiveScale,
  excite,
  COATING_IOR,
  surfaceFor,
  type Finishing,
} from "./surfaces.ts";
import { grainTexture } from "./textures.ts";
import type { Tilt } from "./tilt.ts";
import { fieldOfViewAt, lookFrom, type Viewpoint } from "./viewpoint.ts";

/* --------------------------------------------------------------- the room */

/**
 * How the room changes between themes.
 *
 * The slab does not change — it is the same paint in both — so everything here
 * is about what is around it and how much light is in the air.
 */
type Room = Readonly<{
  /** What the wall behind the slab is painted: one neutral paint everywhere on it. */
  wall: number;
  /** How much of the reflected room each face returns. */
  environment: number;
  /** The lamp that lights the face and throws the shadow. */
  key: number;
  /** Sky and bounce together, so the half turned from the key is not black. */
  fill: number;
  /**
   * The strip, which is the reflection the finishes are read from.
   *
   * Radiance rather than power, so this is how bright the lamp's surface is
   * and not how much light it puts out — a longer strip at the same number is
   * a brighter room.
   */
  strip: number;
  /** How far a bright pixel spills, before the finish's own share of it. */
  bloom: number;
}>;

/**
 * Bright, because the color is the product.
 *
 * A face turned to the camera has to come back reading as the hex it is sold
 * under, which takes about as much light as the paint reflects — anything less
 * and the shop is selling a darker color than it is charging for.
 *
 * Split between the key and the hemisphere, and the split is the whole of how
 * much a finish answers being turned. A hemisphere light has no direction, so
 * light spent there lands the same however the slab stands — a room lit almost
 * entirely by fill leaves a matte face looking identical at every angle, which
 * is the one thing matte paint does not do. Light spent on the key, on the
 * other hand, comes back as a second broad specular on a lacquered face, which
 * is one highlight more than the picture has room for beside the strip.
 *
 * This is the balance where a matte face visibly shades across a turn and a
 * gloss one still has only one reflection on it.
 *
 * The wall is white, so under that much light it sits at about the bright
 * page's own lightness, and the slab stands in the page rather than in a gray
 * box set into it.
 */
const ROOMS: Record<Theme, Room> = {
  light: { wall: 0xffffff, environment: 1.15, key: 2.5, fill: 2.35, strip: 1.15, bloom: 0.35 },
  // Not the same room turned down: a dark room has a dark wall, so the lamp
  // has to work slightly harder for the slab to keep its own color, and bloom
  // carries further because there is somewhere for it to go.
  dark: { wall: 0x232323, environment: 0.95, key: 2.6, fill: 2.05, strip: 1.5, bloom: 0.35 },
};

/** What a hex nobody can parse re-emits. */
const BLACK: Rgb = { red: 0, green: 0, blue: 0 };

/* --------------------------------------------------------------- the slab */

/** Half a degree of corner radius on a slab a meter across, in slab widths. */
const CORNER = 0.055;
const SLAB_DEPTH = 0.05;
const BEVEL = 0.012;

/**
 * A square with rounded corners.
 *
 * The corners are the reason: a sharp-cornered box catches the strip lamp as a
 * point and reads as computer graphics, and a rounded one catches it as a
 * short bright arc, which is what an object looks like.
 */
const roundedSquare = (): Shape => {
  const shape = new Shape();
  const edge = 0.5 - CORNER;

  shape.moveTo(-edge, -0.5);
  shape.lineTo(edge, -0.5);
  shape.absarc(edge, -edge, CORNER, -Math.PI / 2, 0, false);
  shape.lineTo(0.5, edge);
  shape.absarc(edge, edge, CORNER, 0, Math.PI / 2, false);
  shape.lineTo(-edge, 0.5);
  shape.absarc(-edge, edge, CORNER, Math.PI / 2, Math.PI, false);
  shape.lineTo(-0.5, -edge);
  shape.absarc(-edge, -edge, CORNER, Math.PI, (3 * Math.PI) / 2, false);

  return shape;
};

/* ---------------------------------------------------------------- the rig */

/**
 * Everything the slab's scene holds.
 *
 * Held together rather than as loose module variables so that the whole thing
 * is either built or not built, which is the only two states it has.
 */
type Rig = Readonly<{
  scene: Scene;
  camera: PerspectiveCamera;
  slab: Mesh;
  wall: MeshStandardMaterial;
  key: DirectionalLight;
  fill: HemisphereLight;
  strip: RectAreaLight;
  /**
   * One material for every color on the page.
   *
   * Every shader feature it can use is switched on permanently — a lacquer, a
   * coating, a sheen, the grain maps — with values that go to nearly nothing
   * rather than to zero. Three's program key is built from which of those are
   * above zero, so a material that turned one off between two colors would
   * compile a second shader mid-scroll.
   */
  face: MeshPhysicalMaterial;
  /** The paint's grain, held so the material can be pointed back at it. */
  grain: Texture;
}>;

const buildFace = (environment: Texture, grain: Texture): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({
    color: 0xffffff,
    // Placeholders. Every one of these is overwritten per color in `frameFor`;
    // what matters here is only that none of them is zero, so that the shader
    // compiled from this material is the one every color goes on using.
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
    // and no map is needed to vary it across the face.
    iridescenceThicknessRange: [300, 300],
    roughnessMap: grain,
    bumpMap: grain,
    bumpScale: 0.001,
    envMap: environment,
    envMapIntensity: 1,
    emissiveIntensity: 1,
  });

const buildRig = ({ environment }: Studio): Rig => {
  const scene = new Scene();
  scene.environment = environment;

  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 40);

  const geometry = new ExtrudeGeometry(roundedSquare(), {
    depth: SLAB_DEPTH,
    bevelEnabled: true,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
    bevelSegments: 3,
    curveSegments: 12,
  });
  // Extrusion runs from z = 0 forward, so without this the slab turns about
  // its back face and appears to swing rather than to tilt.
  geometry.center();

  const grain = grainTexture();
  const face = buildFace(environment, grain);
  const slab = new Mesh(geometry, face);
  slab.castShadow = true;
  scene.add(slab);

  // Flat. The wall is the neutral ground a color is judged against, and a
  // ground that is brighter in the middle than at the edges is a ground that
  // reports a different color depending on where on it the slab is standing.
  const wall = new MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  wall.envMapIntensity = 0.3;

  const backdrop = new Mesh(new PlaneGeometry(WALL_SIZE, WALL_SIZE), wall);
  backdrop.position.z = -WALL_DISTANCE;
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  const key = new DirectionalLight(0xfffaf4);
  // Round to the side, about thirty-eight degrees off the camera's axis.
  //
  // How far off decides how much a face answers being turned: the cosine of
  // the angle to the lamp barely moves through thirteen degrees when the lamp
  // is straight ahead, and moves by a fifth when it is out here. That swing is
  // the whole of a matte finish's response, since a flat face has no highlight
  // to slide. Further round still would buy more of it and cost the shadow:
  // past about forty degrees the slab stops standing in front of its own
  // shadow and starts standing beside a dark rectangle.
  key.position.set(-1.7, 1.8, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -1.6;
  key.shadow.camera.right = 1.6;
  key.shadow.camera.top = 1.6;
  key.shadow.camera.bottom = -1.6;
  key.shadow.camera.far = 14;
  // Soft to the point of being a smudge. Nothing in the scene is small enough
  // for a defined shadow to describe, and a defined one only announces that
  // the wall is a foot away.
  key.shadow.radius = 8;
  key.shadow.blurSamples = 8;
  key.shadow.normalBias = 0.04;
  // Barely there. A slab a third of a width off the wall blocks very little
  // of a room lit mostly by its own air, and a shadow with any weight to it
  // reads as a second object lying behind the product rather than as depth.
  key.shadow.intensity = 0.22;
  // Driven by hand. See `shadowTilt`.
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  scene.add(key);

  // Sky above, bounce below, and no highlight of its own: a hemisphere light
  // contributes irradiance only. A directional fill here put a second, broad
  // specular on the lacquer opposite the strip, which on a gloss face reads as
  // a smear of white where the color is supposed to be.
  const fill = new HemisphereLight(0xeff3fb, 0xcdc8c1);
  scene.add(fill);

  const strip = new RectAreaLight(0xffffff, 1, 16, 0.4);
  // On the same line as its reflection in the room, because it is the same
  // lamp: a strip the slab returns from one direction while being lit from
  // another is two lamps, and the picture stops adding up.
  //
  // Far longer than the slab is wide. A strip lamp has ends, and an end that
  // lands on the face reads as a scratch rather than as a reflection — so both
  // of them stay outside the picture at every angle the slab can reach.
  strip.position.set(-0.5, 0.46, 3.4);
  strip.lookAt(0, 0, 0);
  // Local Z now points at the slab, so this leans the strip without aiming it
  // anywhere else — and by the same angle as its reflection in the room.
  strip.rotateZ(STRIP_LEAN);
  scene.add(strip);

  return { scene, camera, slab, wall, key, fill, strip, face, grain };
};

/**
 * The slab's scene, built the first time a stage asks for it.
 *
 * One for the document, because there is one of everything in it and only one
 * stage is ever being drawn.
 */
let theRig: Option<Rig> = Option.none;
let attempted = false;

const rigNow = (): Option<Rig> => {
  if (!attempted) {
    attempted = true;
    theRig = Option.map(buildRig)(studio());
  }

  return theRig;
};

/**
 * The angle the shadow map was last rendered at.
 *
 * The map depends on the slab's angle and on nothing else — not on which
 * color is painted on it, and not on which stage is being drawn. Left to
 * update itself it is rebuilt once per stage, so a grid of twelve renders the
 * same shadow twelve times; this way the grid renders it once, and a hover
 * pays for it only on the frames that actually move.
 */
let shadowTilt: Option<Tilt> = Option.none;

/* -------------------------------------------------------------- the stages */

/** One product's picture: what color, made of what, standing at what angle, seen from where. */
export type StageView = Readonly<{
  hex: string;
  finishing: Finishing;
  tilt: Tilt;
  viewpoint: Viewpoint;
}>;

/** A canvas the renderer has agreed to keep painting a color onto. */
export type Stage = GlStage<StageView>;

/** One room, the same for every finish, so the wall is one gray everywhere. */
const applyRoom = (rig: Rig, room: Room): void => {
  rig.wall.color.setHex(room.wall, SRGBColorSpace);
  rig.key.intensity = room.key;
  rig.fill.intensity = room.fill;
  rig.strip.intensity = room.strip;
  rig.scene.environmentIntensity = room.environment;
};

/**
 * Paint the slab and point it, and say what the frame is then made of.
 *
 * Not re-entrant: it moves the one slab and the one material there is, so a
 * second call while it is running would draw the first stage's color onto the
 * second stage's canvas. `gl.ts` calls it synchronously for that reason.
 */
const frameFor = (rig: Rig, view: StageView): Frame => {
  const surface = surfaceFor(view.finishing);
  const { face } = rig;
  const room = ROOMS[themeNow()];

  applyRoom(rig, room);

  // A hex the server sent that will not parse is not a color anybody can
  // draw, so the slab shows the wall's own gray rather than inventing one.
  const pigment = Option.map(toRgb)(parseHex(view.hex));

  Option.match<Rgb, void>({
    onSome: (rgb) =>
      face.color.setRGB(rgb.red / 255, rgb.green / 255, rgb.blue / 255, SRGBColorSpace),
    onNone: () => face.color.copy(rig.wall.color),
  })(pigment);

  // A glowing pigment stays a lit surface. Fluorescence absorbs light and hands
  // it back at a longer wavelength, so the face is shaded and has a highlight
  // like any other — it simply returns more of its own band than fell on it.
  //
  // Both the albedo and the re-emission are that band at full strength: a
  // pigment that fluoresces does it in a narrow band and returns nearly all of
  // it, which is why one is never dark whatever hue it is sold as.
  const band = Option.match<Rgb, Rgb>({
    onSome: excite,
    onNone: () => BLACK,
  })(pigment);

  if (surface.emission > 0) {
    face.color.setRGB(band.red / 255, band.green / 255, band.blue / 255, SRGBColorSpace);
  }

  face.emissive.setRGB(band.red / 255, band.green / 255, band.blue / 255, SRGBColorSpace);
  face.emissiveIntensity = emissiveScale(surface.emission, band);

  face.roughness = surface.roughness;
  face.metalness = surface.metalness;
  face.sheen = Math.max(surface.sheen, MINIMUM_FEATURE);
  face.clearcoat = Math.max(surface.clearcoat, MINIMUM_FEATURE);
  face.clearcoatRoughness = surface.clearcoatRoughness;
  face.iridescence = surface.iridescence;
  face.envMapIntensity = surface.envIntensity;
  face.bumpScale = surface.relief;

  // Both ends the same: a coating is one layer of one thickness, and what
  // color it shows is decided by that number and the angle it is seen at.
  face.iridescenceThicknessRange = [
    surface.coatingNanometers,
    surface.coatingNanometers,
  ];

  rig.slab.rotation.set(view.tilt.x, view.tilt.y, 0);

  const look = lookFrom(SLAB_GAZE, view.viewpoint, FIELD_OF_VIEW);
  rig.camera.position.set(look.eye.x, look.eye.y, look.eye.z);
  rig.camera.lookAt(look.target.x, look.target.y, look.target.z);
  rig.camera.fov = fieldOfViewAt(FIELD_OF_VIEW, view.viewpoint);
  rig.camera.updateProjectionMatrix();

  rig.key.shadow.needsUpdate = Option.match<Tilt, boolean>({
    onSome: (drawn) => drawn.x !== view.tilt.x || drawn.y !== view.tilt.y,
    onNone: () => true,
  })(shadowTilt);
  shadowTilt = Option.some(view.tilt);

  return {
    scene: rig.scene,
    camera: rig.camera,
    bloom: {
      strength: surface.bloom.strength * room.bloom,
      threshold: surface.bloom.threshold,
    },
    clear: rig.wall.color,
  };
};

/**
 * Start painting a color onto a canvas, if there is anything to paint with.
 *
 * `None` means this browser has no WebGL2, which the caller answers by showing
 * the color flat — a worse picture, but the right color, which is the part
 * the shop is actually selling.
 */
export const openStage = (canvas: HTMLCanvasElement): Option<Stage> =>
  Option.flatMap((rig: Rig) =>
    openGlStage<StageView>(canvas, (view) => frameFor(rig, view)),
  )(rigNow());
