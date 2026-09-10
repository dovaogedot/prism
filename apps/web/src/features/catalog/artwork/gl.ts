/**
 * One WebGL context, drawing every picture on the page.
 *
 * A page holds a dozen stages and a browser will not give a dozen WebGL
 * contexts to one document — so there is exactly one renderer and one composer
 * here, and a stage is a plain 2D canvas that the render of its own view is
 * copied into. Only one stage is ever under the pointer, and the rest are
 * still pictures holding whatever was last drawn on them, so the shared
 * renderer is idle except while something is actually moving.
 *
 * What is drawn is not decided here. A caller hands over a function from its
 * own view to a `Frame` — a scene, a camera and a spill — and this points the
 * one render pass at it. That is what lets a color slab and a finisher's room
 * stand side by side in one grid on one context.
 *
 * This and the two scene modules are the only files in the feature that are
 * not referentially transparent, because a GPU context is a resource rather
 * than a value.
 */

import { Option } from "@prism/shared";
import {
  type Color,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
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
import type { Theme } from "../../../shared/theme/use-theme.ts";
import { buildRoom } from "./room.ts";
import type { Bloom } from "./surfaces.ts";

/** Which of the two rooms the shop is lit as, as the document has it. */
export const themeNow = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/**
 * The smallest a shader feature may be set to.
 *
 * Above zero, because three compiles the lacquer and the sheen in or out by
 * whether they are above it — and one material serving a page of colors cannot
 * afford a recompile between two of them.
 */
export const MINIMUM_FEATURE = 0.0001;

/* ------------------------------------------------------------- the context */

/**
 * How far a spilling pixel reaches, as a fraction of the frame.
 *
 * Small on purpose: the point of the spill is to say a surface is brighter
 * than the display can show, and a spill wide enough to reach the wall says
 * instead that the room is that color.
 */
const BLOOM_RADIUS = 0.07;

/** The device pixels of one edge, past which more resolution is not visible. */
const MAX_EDGE = 1400;

/**
 * Everything the GPU holds, once.
 *
 * Together rather than as loose module variables so that the whole thing is
 * either built or not built, which is the only two states it has.
 */
type Context = Readonly<{
  renderer: WebGLRenderer;
  composer: EffectComposer;
  pass: RenderPass;
  bloom: UnrealBloomPass;
  environment: Texture;
}>;

/**
 * What a scene module is handed once the context exists.
 *
 * The environment is the whole of it: a lit surface is a picture of its
 * surroundings, and one convolution serves every scene on the page.
 */
export type Studio = Readonly<{
  /** The convolved room every material samples. */
  environment: Texture;
}>;

/** What one stage wants drawn: a scene, the eye looking at it, and its spill. */
export type Frame = Readonly<{
  scene: Scene;
  camera: PerspectiveCamera;
  bloom: Bloom;
  /** What the frame is cleared to, behind everything in the scene. */
  clear: Color;
}>;

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Whether this context is the CPU pretending to be a GPU.
 *
 * Worth asking, because the answer changes what is worth drawing. Building the
 * context — convolving the room into an environment map, compiling the
 * physical shaders — costs a second and a half without hardware behind it, and
 * every stage after that costs another eighty milliseconds. A grid of flat
 * swatches is a better page than a grid of slabs that arrives three seconds
 * late.
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

const buildContext = (): Option<Context> => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: false, alpha: false });

  // Neither of these is a failure to handle: they are the answer that this
  // browser should be shown the still picture instead.
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

  const pmrem = new PMREMGenerator(renderer);
  // Convolved rather than sampled sharp. The cube map behind it is 256 pixels
  // on a side, so a strip crossing it is a couple of texels wide — magnified
  // across a slab four hundred pixels across, an unblurred one arrives with
  // its own staircase, which the coating's interference then paints in color.
  const environment = pmrem.fromScene(buildRoom(), 0.075);
  pmrem.dispose();

  // The lookup textures an area light's integration needs, loaded once.
  RectAreaLightUniformsLib.init();

  // Multisampled, which FXAA on its own cannot be. A slab is four straight
  // edges and a corner radius against a flat wall — geometric aliasing, which
  // is what multisampling is for; the screen-space filter after it is left to
  // clean up the shading, which is what that is for.
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
  );

  // Pointed at whichever scene the frame carries. Both fields are public on
  // the pass, so one pass and one composer serve every kind of picture, and
  // what it is built with is only what it holds until the first frame.
  const pass = new RenderPass(new Scene(), new PerspectiveCamera());
  composer.addPass(pass);

  // The radius is what decides whether the wall stays a wall. A wide one
  // spreads a glowing face over the whole stage until the background is the
  // color and the subject has no edge left; this one keeps the spill against
  // the edge that threw it.
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0, BLOOM_RADIUS, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Last, after tone mapping: FXAA works on luminance, and the luminance it
  // should be reading is the one the shopper sees.
  composer.addPass(new FXAAPass());

  return Option.some({ renderer, composer, pass, bloom, environment: environment.texture });
};

/**
 * The context, built the first time a stage asks for it.
 *
 * A module-level binding because there is one GPU context per document and no
 * component owns it. `Option` rather than a nullable so that "not built yet"
 * and "cannot be built" are the same shape everywhere downstream.
 */
let theContext: Option<Context> = Option.none;
let attempted = false;

const contextNow = (): Option<Context> => {
  if (!attempted) {
    attempted = true;
    theContext = buildContext();
    watchTheme();
  }

  return theContext;
};

/**
 * The shared surroundings, or the answer that this browser cannot draw them.
 *
 * `None` means no WebGL2 or a software rasterizer, which a caller answers by
 * showing its still picture instead.
 */
export const studio = (): Option<Studio> =>
  Option.map<Context, Studio>(({ environment }) => ({ environment }))(contextNow());

/**
 * Whether this browser would draw live pictures if it were asked to.
 *
 * The switch in the header starts from this: a real GPU renders live, a
 * software rasterizer or no WebGL2 does not. Asked without building anything,
 * so a page that ends up showing stills has not paid for a context first.
 */
export const hasGpu = (): boolean => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: false, alpha: false });

  return context !== null && !isSoftware(context);
};

/**
 * The room is themed and the pictures of it are not live, so every stage on
 * the page has to be repainted when the lights change. One observer for all of
 * them, because the theme is one fact about the document rather than a prop.
 */
const watchTheme = (): void => {
  new MutationObserver(() => {
    for (const stage of open.values()) stage.repaint();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
};

/* -------------------------------------------------------------- the stages */

/** A canvas the renderer has agreed to keep painting. */
export type Stage<View> = Readonly<{
  /** Draw this view onto the canvas, now. */
  draw: (view: View) => void;
  /** Give the canvas back. Nothing is drawn on it afterwards. */
  close: () => void;
}>;

/**
 * A canvas that is being painted.
 *
 * What it was last given is held in the closure that made it, so a theme
 * change or a resize can repaint a stage nobody is pointing at — which is
 * every stage but one.
 */
type Open = Readonly<{
  canvas: HTMLCanvasElement;
  observer: ResizeObserver;
  repaint: () => void;
}>;

const open = new Map<HTMLCanvasElement, Open>();

/**
 * Match the canvas's pixels to the space CSS gave it.
 *
 * Capped at two, above which the extra pixels cost the whole render and buy
 * nothing a shopper can see on a square this small.
 */
const resize = (canvas: HTMLCanvasElement): boolean => {
  const ratio = Math.min(window.devicePixelRatio, 2);
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);

  if (width === canvas.width && height === canvas.height) return false;

  canvas.width = width;
  canvas.height = height;

  return true;
};

/**
 * Render one frame at one canvas's size and copy the result onto it.
 *
 * Not re-entrant: it points the one render pass somewhere and resizes the one
 * renderer, so a second call while it is running would draw the first stage's
 * picture onto the second stage's canvas. Every call site is synchronous for
 * that reason.
 */
const paint = (
  context: Context,
  canvas: HTMLCanvasElement,
  target: CanvasRenderingContext2D,
  frame: Frame,
): void => {
  const width = Math.min(canvas.width, MAX_EDGE);
  const height = Math.min(canvas.height, MAX_EDGE);

  if (width === 0 || height === 0) return;

  const { renderer, composer, pass, bloom } = context;

  if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
  }

  if (frame.camera.aspect !== width / height) {
    frame.camera.aspect = width / height;
    frame.camera.updateProjectionMatrix();
  }

  pass.scene = frame.scene;
  pass.camera = frame.camera;

  bloom.enabled = frame.bloom.strength > 0;
  bloom.strength = frame.bloom.strength;
  bloom.threshold = frame.bloom.threshold;

  renderer.setClearColor(frame.clear);
  composer.render();

  target.clearRect(0, 0, canvas.width, canvas.height);
  target.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
};

/**
 * Start painting a canvas, if there is anything to paint with.
 *
 * `frameFor` runs immediately before every render, so a caller that shares one
 * scene between stages does its own pointing and painting inside it. The view
 * it was last called with is remembered, so this stage can be repainted when
 * the theme or the canvas size changes under it.
 */
export const openStage = <View>(
  canvas: HTMLCanvasElement,
  frameFor: (view: View) => Frame,
): Option<Stage<View>> =>
  Option.match<Context, Option<Stage<View>>>({
    onNone: () => Option.none,
    onSome: (context) => {
      const target = canvas.getContext("2d");

      if (target === null) return Option.none;

      let last: Option<View> = Option.none;

      const repaint = (): void =>
        Option.match<View, void>({
          onSome: (view) => paint(context, canvas, target, frameFor(view)),
          onNone: () => undefined,
        })(last);

      const observer = new ResizeObserver(() => {
        if (resize(canvas)) repaint();
      });

      open.set(canvas, { canvas, observer, repaint });
      observer.observe(canvas);

      return Option.some({
        draw: (view) => {
          last = Option.some(view);
          resize(canvas);
          repaint();
        },
        close: () => {
          observer.disconnect();
          open.delete(canvas);
        },
      });
    },
  })(contextNow());
