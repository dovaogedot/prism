/**
 * One WebGL context, drawing every color on the page.
 *
 * A page holds a dozen stages and a browser will not give a dozen WebGL
 * contexts to one document — so there is exactly one renderer, one scene and
 * one slab in this module, and a stage is a plain 2D canvas that the render of
 * its own view is copied into. Only one stage is ever under the pointer, and
 * the rest are still pictures that hold whatever was last drawn on them, so
 * the shared renderer is idle except while something is actually moving.
 *
 * This is the only file in the feature that is not referentially transparent,
 * because a GPU context is a resource rather than a value. Everything it
 * decides comes from `surfaces.ts` and `tilt.ts`, which are.
 */

import { Option, parseHex, toRgb, type Rgb } from "@prism/shared";
import {
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RectAreaLight,
  Scene,
  Shape,
  SRGBColorSpace,
  HalfFloatType,
  type Texture,
  Vector2,
  VSMShadowMap,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { buildRoom, STRIP_LEAN } from "./room.ts";
import {
  emissiveScale,
  excite,
  COATING_IOR,
  surfaceFor,
  type Finishing,
} from "./surfaces.ts";
import { grainTexture } from "./textures.ts";
import type { Tilt } from "./tilt.ts";

/* --------------------------------------------------------------- the room */

/** Which of the two rooms the shop is currently lit as. */
type Theme = "light" | "dark";

/**
 * How the room changes between themes.
 *
 * The slab does not change — it is the same paint in both — so everything here
 * is about what is around it and how much light is in the air.
 */
type Room = Readonly<{
  /** The wall behind the slab. Gray, and the same gray everywhere on it. */
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
 */
const ROOMS: Record<Theme, Room> = {
  light: { wall: 0xb0b0b0, environment: 1.15, key: 2.5, fill: 2.35, strip: 1.15, bloom: 0.35 },
  // Not the same room turned down: a dark room has a dark wall, so the lamp
  // has to work slightly harder for the slab to keep its own color, and bloom
  // carries further because there is somewhere for it to go.
  dark: { wall: 0x232323, environment: 0.95, key: 2.6, fill: 2.05, strip: 1.5, bloom: 0.35 },
};

const themeNow = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** Reused rather than allocated: `paint` runs on every frame of a hover. */
const CLEAR = new Color();

/** What a hex nobody can parse re-emits. */
const BLACK: Rgb = { red: 0, green: 0, blue: 0 };

/**
 * The smallest a shader feature may be set to.
 *
 * Above zero, because three compiles the lacquer and the sheen in or out by
 * whether they are above it — and one material serving a page of colors cannot
 * afford a recompile between two of them.
 */
const MINIMUM_FEATURE = 0.0001;

/* --------------------------------------------------------------- the slab */

/**
 * How far a spilling pixel reaches, as a fraction of the frame.
 *
 * Small on purpose: the point of the spill is to say a surface is brighter
 * than the display can show, and a spill wide enough to reach the wall says
 * instead that the room is that color.
 */
const BLOOM_RADIUS = 0.07;

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
 * Everything that exists once.
 *
 * Held together rather than as loose module variables so that the whole thing
 * is either built or not built, which is the only two states it has.
 */
type Rig = Readonly<{
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
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

/** How far the camera stands back, in slab widths. A long lens on a product. */
const CAMERA_DISTANCE = 3.9;
const FIELD_OF_VIEW = 26;

/**
 * How far the wall is behind the slab.
 *
 * Close, because the shadow lands on it: a wall further back takes the shadow
 * out of the picture with it and leaves the slab floating in front of nothing.
 */
const WALL_DISTANCE = 0.36;

/** Comfortably wider than the frame at the wall's depth, and no wider. */
const WALL_SIZE = 3.6;

/** The device pixels of one edge, past which more resolution is not visible. */
const MAX_EDGE = 1400;

const buildFace = (
  environment: ReturnType<PMREMGenerator["fromScene"]>,
  grain: Texture,
): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({
    color: 0xffffff,
    // Placeholders. Every one of these is overwritten per color in `paint`;
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
    envMap: environment.texture,
    envMapIntensity: 1,
    emissiveIntensity: 1,
  });

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Whether this context is the CPU pretending to be a GPU.
 *
 * Worth asking, because the answer changes what is worth drawing. Building the
 * rig — convolving the room into an environment map, compiling four physical
 * shaders — costs a second and a half without hardware behind it, and every
 * stage after that costs another eighty milliseconds. A grid of flat swatches
 * is a better page than a grid of slabs that arrives three seconds late.
 *
 * The extension is the only way to ask and some browsers withhold it, in which
 * case the honest answer is that we do not know, and the scene gets the
 * benefit of the doubt.
 */
const isSoftware = (context: WebGL2RenderingContext): boolean => {
  const info = context.getExtension("WEBGL_debug_renderer_info");

  if (info === null) return false;

  // `getParameter` is typed as `any`, which is the one place a value really is
  // unknown until it has been checked.
  const name: unknown = context.getParameter(info.UNMASKED_RENDERER_WEBGL);

  return typeof name === "string" && SOFTWARE_RENDERER.test(name);
};

const buildRig = (): Option<Rig> => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: false, alpha: false });

  // Neither of these is a failure to handle: they are the answer that this
  // browser should be shown the flat swatch instead.
  if (context === null || isSoftware(context)) return Option.none;

  // Antialiasing is off on the context because nothing is drawn to it
  // directly — every pass goes through the composer's own targets.
  const renderer = new WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(1);
  renderer.toneMapping = NeutralToneMapping;
  // Under one, so that a near-white pigment still has somewhere to go. At full
  // exposure the palest colors in the catalog sit against the ceiling of the
  // curve, where turning the slab changes nothing because nothing can get
  // brighter than it already is.
  renderer.toneMappingExposure = 0.84;
  renderer.shadowMap.enabled = true;
  // Variance shadows, because they are the ones that honor `radius`: the
  // percentage-closer filter takes its kernel from the texel size and gives
  // the same hard edge whatever is asked of it, and a hard-edged shadow on a
  // wall this close to the slab reads as a second object rather than a shadow.
  renderer.shadowMap.type = VSMShadowMap;

  const scene = new Scene();

  const pmrem = new PMREMGenerator(renderer);
  // Convolved rather than sampled sharp. The cube map behind it is 256 pixels
  // on a side, so a strip crossing it is a couple of texels wide — magnified
  // across a slab four hundred pixels across, an unblurred one arrives with
  // its own staircase, which the coating's interference then paints in color.
  const environment = pmrem.fromScene(buildRoom(), 0.075);
  pmrem.dispose();
  scene.environment = environment.texture;

  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 40);
  camera.position.set(0, 0, CAMERA_DISTANCE);

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

  // The lookup textures the area light's integration needs, loaded once.
  RectAreaLightUniformsLib.init();

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

  // Multisampled, which FXAA on its own cannot be. The slab is four straight
  // edges and a corner radius against a flat wall — geometric aliasing, which
  // is what multisampling is for; the screen-space filter after it is left to
  // clean up the shading, which is what that is for.
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));

  // The radius is what decides whether the wall stays a wall. A wide one
  // spreads a glowing face over the whole stage until the background is the
  // color and the slab has no edge left; this one keeps the spill against the
  // edge that threw it.
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0, BLOOM_RADIUS, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Last, after tone mapping: FXAA works on luminance, and the luminance it
  // should be reading is the one the shopper sees. A screen-space filter
  // rather than multisampling, because the slab is four straight edges and a
  // corner radius — there is nothing here that needs the expensive kind.
  composer.addPass(new FXAAPass());

  return Option.some({
    renderer,
    scene,
    camera,
    composer,
    bloom,
    slab,
    wall,
    key,
    fill,
    strip,
    face,
    grain,
  });
};

/**
 * The rig, built the first time a stage asks for it.
 *
 * A module-level binding because there is one GPU context per document and no
 * component owns it. `Option` rather than a nullable so that "not built yet"
 * and "cannot be built" are the same shape everywhere downstream.
 */
let theRig: Option<Rig> = Option.none;
let rigAttempted = false;

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

const rigNow = (): Option<Rig> => {
  if (!rigAttempted) {
    rigAttempted = true;
    theRig = buildRig();
    watchTheme();
  }

  return theRig;
};

/**
 * The room is themed and the pictures of it are not live, so every stage on
 * the page has to be repainted when the lights change. One observer for all of
 * them, because the theme is one fact about the document rather than a prop.
 */
const watchTheme = (): void => {
  new MutationObserver(() => {
    for (const entry of painted.values()) repaint(entry);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
};

/* -------------------------------------------------------------- the stages */

/** One product's picture: what color, made of what, standing at what angle. */
export type StageView = Readonly<{
  hex: string;
  finishing: Finishing;
  tilt: Tilt;
}>;

/** A canvas the renderer has agreed to keep painting. */
export type Stage = Readonly<{
  /** Draw this view onto the canvas, now. */
  draw: (view: StageView) => void;
  /** Give the canvas back. Nothing is drawn on it afterwards. */
  close: () => void;
}>;

/**
 * A canvas that is being painted, and the last thing painted on it.
 *
 * The view is kept so that a theme change or a resize can repaint a stage
 * nobody is pointing at, which is every stage but one.
 */
type Painted = {
  readonly context: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly observer: ResizeObserver;
  view: Option<StageView>;
};

const painted = new Map<HTMLCanvasElement, Painted>();

/** One room, the same for every finish, so the wall is one gray everywhere. */
const applyRoom = (rig: Rig, room: Room): void => {
  rig.wall.color.setHex(room.wall, SRGBColorSpace);
  rig.key.intensity = room.key;
  rig.fill.intensity = room.fill;
  rig.strip.intensity = room.strip;
  rig.scene.environmentIntensity = room.environment;
};

/**
 * Point the slab, paint it, and copy the result onto the stage's own canvas.
 *
 * Not re-entrant: it moves the one slab and the one material there is, so a
 * second call while it is running would draw the first stage's color onto the
 * second stage's canvas. Every call site is synchronous for that reason.
 */
const paint = (rig: Rig, entry: Painted, view: StageView): void => {
  const width = Math.min(entry.canvas.width, MAX_EDGE);
  const height = Math.min(entry.canvas.height, MAX_EDGE);

  if (width === 0 || height === 0) return;

  if (rig.renderer.domElement.width !== width || rig.renderer.domElement.height !== height) {
    rig.renderer.setSize(width, height, false);
    rig.composer.setSize(width, height);
    rig.camera.aspect = width / height;
    rig.camera.updateProjectionMatrix();
  }

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

  rig.key.shadow.needsUpdate = Option.match<Tilt, boolean>({
    onSome: (drawn) => drawn.x !== view.tilt.x || drawn.y !== view.tilt.y,
    onNone: () => true,
  })(shadowTilt);
  shadowTilt = Option.some(view.tilt);

  rig.bloom.enabled = surface.bloom.strength > 0;
  rig.bloom.strength = surface.bloom.strength * room.bloom;
  rig.bloom.threshold = surface.bloom.threshold;

  rig.renderer.setClearColor(rig.wall.color);
  rig.composer.render();

  entry.context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
  entry.context.drawImage(rig.renderer.domElement, 0, 0, entry.canvas.width, entry.canvas.height);
};

const repaint = (entry: Painted): void => {
  Option.match<Rig, void>({
    onSome: (rig) =>
      Option.match<StageView, void>({
        onSome: (view) => paint(rig, entry, view),
        onNone: () => undefined,
      })(entry.view),
    onNone: () => undefined,
  })(rigNow());
};

/**
 * Match the canvas's pixels to the space CSS gave it.
 *
 * Capped at two, above which the extra pixels cost the whole render and buy
 * nothing a shopper can see on a square this small.
 */
const resize = (entry: Painted): boolean => {
  const ratio = Math.min(window.devicePixelRatio, 2);
  const width = Math.round(entry.canvas.clientWidth * ratio);
  const height = Math.round(entry.canvas.clientHeight * ratio);

  if (width === entry.canvas.width && height === entry.canvas.height) return false;

  entry.canvas.width = width;
  entry.canvas.height = height;

  return true;
};

/**
 * Start painting a canvas, if there is anything to paint with.
 *
 * `None` means this browser has no WebGL2, which the caller answers by showing
 * the color flat — a worse picture, but the right color, which is the part
 * the shop is actually selling.
 */
export const openStage = (canvas: HTMLCanvasElement): Option<Stage> =>
  Option.match<Rig, Option<Stage>>({
    onNone: () => Option.none,
    onSome: () => {
      const context = canvas.getContext("2d");

      if (context === null) return Option.none;

      const entry: Painted = {
        canvas,
        context,
        view: Option.none,
        observer: new ResizeObserver(() => {
          if (resize(entry)) repaint(entry);
        }),
      };

      painted.set(canvas, entry);
      entry.observer.observe(canvas);

      return Option.some({
        draw: (view) => {
          entry.view = Option.some(view);
          resize(entry);
          repaint(entry);
        },
        close: () => {
          entry.observer.disconnect();
          painted.delete(canvas);
        },
      });
    },
  })(rigNow());

