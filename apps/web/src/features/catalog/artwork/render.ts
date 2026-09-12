/**
 * The one thing that draws a `Scene`.
 *
 * `scenes.ts` says what every picture is made of, and this builds it out of
 * three.js objects and keeps them up to date. It carries no number of its own:
 * every shape, place, paint, lamp, lens and haze it sets is read from the
 * description it was handed, so changing how a picture looks is a change to
 * the data there and never a change here.
 *
 * One mounted graph per kind of picture, kept for the life of the document
 * and moved to match each description as it comes: a page holds a dozen
 * stages and only one of them is ever being drawn, so one graph per kind
 * serves all of them. That is why nothing here is re-entrant — a second call
 * while one is running would put the first stage's picture on the second
 * stage's canvas — and why `gl.ts` calls it synchronously.
 *
 * This and `gl.ts` are the only files in the feature that are not
 * referentially transparent, because a GPU graph is a resource rather than a
 * value.
 */

import { Option, type Rgb } from "@prism/shared";
import {
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Fog,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RectAreaLight,
  Scene as Graph,
  Shape as Outline,
  SpotLight,
  SRGBColorSpace,
  type Texture,
} from "three";
import { match, P } from "ts-pattern";
import {
  type Frame,
  MINIMUM_FEATURE,
  openStage,
  type Stage,
  studio,
  themeNow,
} from "./gl.ts";
import { meshNow } from "./mesh.ts";
import {
  type Camera,
  type ColorView,
  type DirectionalShadow,
  type FinisherView,
  type Fog as Haze,
  type Light,
  type Material,
  scene,
  type Scene,
  type SceneType,
  type Shadowing,
  type Shape,
  type Shell,
  type ShellForm,
  type SpotShadow,
  type Subject,
  type View,
} from "./scenes.ts";
import { COATING_IOR } from "./surfaces.ts";
import { grainTexture } from "./textures.ts";

/* --------------------------------------------------------------- the paint */

/** Set a three color from a paint measured out of 255 per channel. */
const paint = (color: Color, rgb: Rgb): Color =>
  color.setRGB(rgb.red / 255, rgb.green / 255, rgb.blue / 255, SRGBColorSpace);

/* ------------------------------------------------------------ the subjects */

/** What the page holds once, for every subject to be built from. */
export type Kit = Readonly<{
  /** The convolved surroundings every material samples. */
  environment: Texture;
  /** The vendored mesh every head is, once it has arrived. */
  head: Option<BufferGeometry>;
  /** The grain a slab's paint carries. */
  grain: Texture;
}>;

/**
 * The paint one subject wears.
 *
 * Every shader feature it can use is switched on, with values that go to
 * nearly nothing rather than to zero: three keys its programs on which
 * features are above zero, and a material that turned one off between two
 * pictures would compile a second shader mid-scroll. What is here is only
 * what makes the compiled program the one every picture goes on using; every
 * number a picture sets is applied over it.
 */
const pigmentOf = (kit: Kit, shape: Shape): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.55,
    sheenColor: 0xffffff,
    clearcoat: 0.5,
    clearcoatRoughness: 0.05,
    iridescence: 0.5,
    iridescenceIOR: COATING_IOR,
    iridescenceThicknessRange: [300, 300],
    envMap: kit.environment,
    envMapIntensity: 1,
    emissiveIntensity: 1,
    // A grain is laid along a surface's UVs, and only the slab has any: the
    // vendored mesh carries none.
    ...match(shape)
      .with({ _tag: "Slab" }, () => ({
        roughnessMap: kit.grain,
        bumpMap: kit.grain,
        bumpScale: 0.001,
      }))
      .with({ _tag: "Head" }, () => ({}))
      .exhaustive(),
  });

/** A square `corner`-rounded outline, one unit across, centered on the origin. */
const roundedSquare = (corner: number): Outline => {
  const outline = new Outline();
  const edge = 0.5 - corner;

  outline.moveTo(-edge, -0.5);
  outline.lineTo(edge, -0.5);
  outline.absarc(edge, -edge, corner, -Math.PI / 2, 0, false);
  outline.lineTo(0.5, edge);
  outline.absarc(edge, edge, corner, 0, Math.PI / 2, false);
  outline.lineTo(-edge, 0.5);
  outline.absarc(-edge, edge, corner, Math.PI / 2, Math.PI, false);
  outline.lineTo(-0.5, -edge);
  outline.absarc(-edge, -edge, corner, Math.PI, (3 * Math.PI) / 2, false);

  return outline;
};

/** The geometry of a shape, if the page holds what it takes to build it. */
const geometryOf = (kit: Kit, shape: Shape): Option<BufferGeometry> =>
  match(shape)
    .with({ _tag: "Head" }, () => kit.head)
    .with({ _tag: "Slab" }, ({ corner, depth, bevel }) => {
      const geometry = new ExtrudeGeometry(roundedSquare(corner), {
        depth,
        bevelEnabled: true,
        bevelSize: bevel,
        bevelThickness: bevel,
        bevelSegments: 3,
        curveSegments: 12,
      });
      // Extrusion runs from z = 0 forward, so without this the slab turns
      // about its back face and appears to swing rather than to tilt.
      geometry.center();

      return Option.some(geometry);
    })
    .exhaustive();

/** One subject as it stands in the graph. */
type MountedSubject = Readonly<{ mesh: Mesh; pigment: MeshPhysicalMaterial }>;

/** Stand one subject in the graph, if its shape can be built. */
const mountSubject = (graph: Graph, kit: Kit, subject: Subject): Option<MountedSubject> =>
  Option.map((geometry: BufferGeometry): MountedSubject => {
    const pigment = pigmentOf(kit, subject.shape);
    const mesh = new Mesh(geometry, pigment);

    mesh.castShadow = true;
    graph.add(mesh);

    return { mesh, pigment };
  })(geometryOf(kit, subject.shape));

/** Put a subject where the description says, wearing what it says. */
const applySubject = (mounted: MountedSubject, subject: Subject): void => {
  const { transform, material } = subject;
  const { mesh, pigment } = mounted;

  mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
  mesh.rotation.order = transform.order;
  mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  mesh.scale.setScalar(transform.scale);

  applyMaterial(pigment, material);
};

/** Put a material's numbers on a pigment. */
const applyMaterial = (pigment: MeshPhysicalMaterial, material: Material): void => {
  paint(pigment.color, material.color);
  paint(pigment.emissive, material.emissive);
  pigment.emissiveIntensity = material.emissiveIntensity;
  pigment.roughness = material.roughness;
  pigment.metalness = material.metalness;
  // Never quite off: see `pigmentOf`.
  pigment.sheen = Math.max(material.sheen, MINIMUM_FEATURE);
  pigment.clearcoat = Math.max(material.clearcoat, MINIMUM_FEATURE);
  pigment.clearcoatRoughness = material.clearcoatRoughness;
  pigment.iridescence = material.iridescence;
  pigment.envMapIntensity = material.envIntensity;
  pigment.bumpScale = material.relief;
  // Both ends the same: a coating is one layer of one thickness, and what
  // color it shows follows from that number and the angle it is seen at.
  pigment.iridescenceThicknessRange = [material.coatingNanometers, material.coatingNanometers];
};

/* --------------------------------------------------------------- the shell */

/** The paints of a shell as it stands in the graph, one per kind of surface. */
type MountedShell = Readonly<{
  walls: MeshStandardMaterial;
  floor: MeshStandardMaterial;
}>;

/** A surface of the shell, catching every shadow laid on it. */
const surfaceOf = (
  graph: Graph,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
): Mesh => {
  const face = new Mesh(geometry, material);

  face.receiveShadow = true;
  graph.add(face);

  return face;
};

/** Lay the floor and raise whatever walls the shell has. */
const mountShell = (graph: Graph, shell: Shell): MountedShell => {
  const finish = { roughness: shell.roughness, metalness: 0 };
  const mounted: MountedShell = {
    walls: new MeshStandardMaterial(finish),
    floor: new MeshStandardMaterial(finish),
  };

  mounted.walls.envMapIntensity = shell.environment;
  mounted.floor.envMapIntensity = shell.environment;

  match(shell.form)
    .with({ _tag: "Corner" }, ({ wallAt, extent }) => {
      surfaceOf(graph, new PlaneGeometry(extent, extent), mounted.floor).rotation.x =
        -Math.PI / 2;

      // Centered half an extent up, so the bottom edge of each wall is exactly
      // the floor and the top is far outside the frame.
      const back = surfaceOf(graph, new PlaneGeometry(extent, extent), mounted.walls);
      back.position.set(0, extent / 2, -wallAt);

      const side = surfaceOf(graph, new PlaneGeometry(extent, extent), mounted.walls);
      side.position.set(-wallAt, extent / 2, 0);
      side.rotation.y = Math.PI / 2;
    })
    .with({ _tag: "Drum" }, ({ radius, height }) => {
      // Seen from inside, both of them: the eye stands on this floor rather
      // than looking down onto it.
      mounted.walls.side = DoubleSide;
      mounted.floor.side = DoubleSide;

      surfaceOf(graph, new CircleGeometry(radius, 64), mounted.floor).rotation.x = -Math.PI / 2;
      surfaceOf(
        graph,
        new CylinderGeometry(radius, radius, height, 64, 1, true),
        mounted.walls,
      ).position.y = height / 2;
    })
    .with({ _tag: "Backdrop" }, ({ size, distance }) => {
      surfaceOf(graph, new PlaneGeometry(size, size), mounted.walls).position.z = -distance;
    })
    .exhaustive();

  return mounted;
};

/** Paint the shell what the description says. */
const applyShell = (mounted: MountedShell, form: ShellForm): void => {
  match(form)
    .with({ _tag: P.union("Corner", "Drum") }, ({ walls, floor }) => {
      paint(mounted.walls.color, walls);
      paint(mounted.floor.color, floor);
    })
    .with({ _tag: "Backdrop" }, ({ wall }) => {
      paint(mounted.walls.color, wall);
    })
    .exhaustive();
};

/* -------------------------------------------------------------- the lights */

/** One lamp as it hangs in the graph. */
type MountedLight =
  | Readonly<{ _tag: "Directional"; light: DirectionalLight }>
  | Readonly<{ _tag: "Spot"; light: SpotLight }>
  | Readonly<{ _tag: "Point"; light: PointLight }>
  | Readonly<{ _tag: "RectArea"; light: RectAreaLight }>
  | Readonly<{ _tag: "Hemisphere"; light: HemisphereLight }>;

/**
 * Have a lamp lay its shadow, and keep it.
 *
 * The map is rendered on the first frame that wants it and then only when
 * something it depends on has moved (see `shadowsMoved`), however many
 * stages are drawn from it in between.
 */
const castsShadow = (lamp: DirectionalLight | SpotLight, shadowing: Shadowing): void => {
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(shadowing.mapSize, shadowing.mapSize);
  lamp.shadow.radius = shadowing.softness;
  lamp.shadow.blurSamples = shadowing.blurSamples;
  lamp.shadow.normalBias = shadowing.normalBias;
  lamp.shadow.intensity = shadowing.intensity;
  lamp.shadow.autoUpdate = false;
  lamp.shadow.needsUpdate = true;
};

/** Hang one lamp in the graph. */
const mountLight = (graph: Graph, light: Light): MountedLight =>
  match(light)
    .with({ _tag: "Directional" }, ({ shadow }): MountedLight => {
      const lamp = new DirectionalLight();

      Option.match<DirectionalShadow, void>({
        onSome: (casting) => {
          lamp.shadow.camera.left = -casting.reach;
          lamp.shadow.camera.right = casting.reach;
          lamp.shadow.camera.top = casting.reach;
          lamp.shadow.camera.bottom = -casting.reach;
          lamp.shadow.camera.far = casting.far;
          castsShadow(lamp, casting);
        },
        onNone: () => undefined,
      })(shadow);
      graph.add(lamp);

      return { _tag: "Directional", light: lamp };
    })
    .with({ _tag: "Spot" }, ({ shadow }): MountedLight => {
      const lamp = new SpotLight();

      // Aimed by a target object of its own, so a lamp that travels keeps
      // pointing at the same place without anything having to turn it.
      graph.add(lamp.target);
      Option.match<SpotShadow, void>({
        onSome: (casting) => {
          lamp.shadow.camera.near = casting.near;
          lamp.shadow.camera.far = casting.far;
          castsShadow(lamp, casting);
        },
        onNone: () => undefined,
      })(shadow);
      graph.add(lamp);

      return { _tag: "Spot", light: lamp };
    })
    .with({ _tag: "Point" }, (): MountedLight => {
      const lamp = new PointLight();

      graph.add(lamp);

      return { _tag: "Point", light: lamp };
    })
    .with({ _tag: "RectArea" }, (): MountedLight => {
      const lamp = new RectAreaLight();

      graph.add(lamp);

      return { _tag: "RectArea", light: lamp };
    })
    .with({ _tag: "Hemisphere" }, (): MountedLight => {
      const lamp = new HemisphereLight();

      graph.add(lamp);

      return { _tag: "Hemisphere", light: lamp };
    })
    .exhaustive();

/**
 * Set a lamp to what the description says.
 *
 * Matched as a pair, so a lamp of one kind is only ever set from a
 * description of the same kind; a mismatch is a description whose lamps
 * changed kind under a mounted graph, which `scenes.ts` never does.
 */
const applyLight = (mounted: MountedLight, light: Light): void => {
  match([mounted, light] as const)
    .with(
      [{ _tag: "Directional" }, { _tag: "Directional" }],
      ([{ light: lamp }, { color, intensity, at }]) => {
        paint(lamp.color, color);
        lamp.intensity = intensity;
        lamp.position.set(at.x, at.y, at.z);
      },
    )
    .with(
      [{ _tag: "Spot" }, { _tag: "Spot" }],
      ([{ light: lamp }, { color, intensity, at, aimedAt, angle, penumbra }]) => {
        paint(lamp.color, color);
        lamp.intensity = intensity;
        lamp.position.set(at.x, at.y, at.z);
        lamp.target.position.set(aimedAt.x, aimedAt.y, aimedAt.z);
        lamp.angle = angle;
        lamp.penumbra = penumbra;
      },
    )
    .with([{ _tag: "Point" }, { _tag: "Point" }], ([{ light: lamp }, { color, intensity, at }]) => {
      paint(lamp.color, color);
      lamp.intensity = intensity;
      lamp.position.set(at.x, at.y, at.z);
    })
    .with(
      [{ _tag: "RectArea" }, { _tag: "RectArea" }],
      ([{ light: lamp }, { color, intensity, at, aimedAt, width, height, lean }]) => {
        paint(lamp.color, color);
        lamp.intensity = intensity;
        lamp.width = width;
        lamp.height = height;
        lamp.position.set(at.x, at.y, at.z);
        lamp.lookAt(aimedAt.x, aimedAt.y, aimedAt.z);
        // Local z now points at what it is aimed at, so this leans the panel
        // without aiming it anywhere else.
        lamp.rotateZ(lean);
      },
    )
    .with(
      [{ _tag: "Hemisphere" }, { _tag: "Hemisphere" }],
      ([{ light: lamp }, { sky, ground, intensity }]) => {
        paint(lamp.color, sky);
        paint(lamp.groundColor, ground);
        lamp.intensity = intensity;
      },
    )
    .otherwise(() => undefined);
};

/** Whether a lamp lays a shadow. */
const castsOf = (light: Light): boolean =>
  match(light)
    .with({ _tag: "Directional" }, ({ shadow }) => Option.isSome(shadow))
    .with({ _tag: "Spot" }, ({ shadow }) => Option.isSome(shadow))
    .otherwise(() => false);

/** Whether two places are the same place. */
const samePlace = (
  one: Readonly<{ x: number; y: number; z: number }>,
  other: Readonly<{ x: number; y: number; z: number }>,
): boolean => one.x === other.x && one.y === other.y && one.z === other.z;

/**
 * Whether anything a shadow depends on stands elsewhere in `next` than it did
 * in `last`.
 *
 * A shadow depends on where every subject stands and how it is turned, and on
 * where every lamp that lays one hangs and what it is aimed at. Nothing else
 * about a scene — its paint, how bright its lamps burn, where its eye is —
 * moves a shadow, so a scene that differs only in those keeps the maps it has.
 */
export const shadowsMoved = (last: Scene, next: Scene): boolean =>
  last.subjects.length !== next.subjects.length ||
  last.subjects.some((before, at) => {
    const after = next.subjects[at];

    return (
      after === undefined ||
      !samePlace(before.transform.position, after.transform.position) ||
      !samePlace(before.transform.rotation, after.transform.rotation) ||
      before.transform.order !== after.transform.order ||
      before.transform.scale !== after.transform.scale
    );
  }) ||
  last.lights.length !== next.lights.length ||
  last.lights.some((before, at) => {
    const after = next.lights[at];

    return (
      after === undefined ||
      match([before, after] as const)
        .with(
          [{ _tag: "Directional" }, { _tag: "Directional" }],
          ([one, other]) => castsOf(one) && !samePlace(one.at, other.at),
        )
        .with(
          [{ _tag: "Spot" }, { _tag: "Spot" }],
          ([one, other]) =>
            castsOf(one) &&
            (!samePlace(one.at, other.at) || !samePlace(one.aimedAt, other.aimedAt)),
        )
        .otherwise(() => castsOf(before) !== castsOf(after))
    );
  });

/* --------------------------------------------------------------- the graph */

/** One kind of picture, built and kept. */
export type Mounted = Readonly<{
  graph: Graph;
  camera: PerspectiveCamera;
  subjects: readonly MountedSubject[];
  shell: MountedShell;
  lights: readonly MountedLight[];
  fog: Option<Fog>;
  clear: Color;
  /** The description last drawn from it, which is what the shadows are of. */
  drawn: { last: Option<Scene> };
}>;

/**
 * Build the graph for a description.
 *
 * `None` when a shape in it cannot be built yet, which is a head whose mesh
 * has not arrived: a graph short a subject is a wrong picture rather than a
 * late one, so none is built until every shape can be. Subjects are built
 * before the shell and the lamps in the order they are listed, so the
 * materials and lights are created in the order the description names them.
 * Nothing in the graph is set to the description yet: `apply` does that, and
 * does it for every description drawn.
 */
export const mount = (kit: Kit, described: Scene): Option<Mounted> => {
  const graph = new Graph();
  graph.environment = kit.environment;

  return Option.map((subjects: readonly MountedSubject[]): Mounted => {
    const shell = mountShell(graph, described.shell);
    const lights = described.lights.map((light) => mountLight(graph, light));
    const fog = Option.map((haze: Haze): Fog => {
      const mist = new Fog(0, haze.near, haze.far);
      graph.fog = mist;

      return mist;
    })(described.fog);

    return {
      graph,
      camera: new PerspectiveCamera(
        described.camera.fieldOfView,
        1,
        described.camera.near,
        described.camera.far,
      ),
      subjects,
      shell,
      lights,
      fog,
      clear: new Color(),
      drawn: { last: Option.none },
    };
  })(Option.all(described.subjects.map((subject) => mountSubject(graph, kit, subject))));
};

/** Stand the eye where the description says, and see through its lens. */
const applyCamera = (camera: PerspectiveCamera, described: Camera): void => {
  camera.position.set(described.eye.x, described.eye.y, described.eye.z);
  camera.lookAt(described.target.x, described.target.y, described.target.z);
  camera.fov = described.fieldOfView;
  camera.near = described.near;
  camera.far = described.far;
  camera.updateProjectionMatrix();
};

/**
 * Move a mounted graph to match a description, and say what the frame is then
 * made of.
 *
 * Every number in the description is applied every time, to a graph mounted
 * from a description of the same kind; the shadow maps alone are kept from
 * the last description drawn unless something they depend on has moved,
 * because they are the one thing that costs a render to set.
 */
export const apply = (mounted: Mounted, described: Scene): Frame => {
  for (let at = 0; at < mounted.subjects.length; at += 1) {
    const subject = mounted.subjects[at];
    const description = described.subjects[at];

    if (subject !== undefined && description !== undefined) applySubject(subject, description);
  }

  applyShell(mounted.shell, described.shell.form);

  for (let at = 0; at < mounted.lights.length; at += 1) {
    const light = mounted.lights[at];
    const description = described.lights[at];

    if (light !== undefined && description !== undefined) applyLight(light, description);
  }

  applyCamera(mounted.camera, described.camera);

  paint(mounted.clear, described.air.clear.paint).multiplyScalar(described.air.clear.level);
  mounted.graph.environmentIntensity = described.air.environment;

  Option.match<Fog, void>({
    onSome: (mist) => {
      mist.color.copy(mounted.clear);
      Option.match<Haze, void>({
        onSome: ({ near, far }) => {
          mist.near = near;
          mist.far = far;
        },
        onNone: () => undefined,
      })(described.fog);
    },
    onNone: () => undefined,
  })(mounted.fog);

  const relay = Option.match<Scene, boolean>({
    onSome: (last) => shadowsMoved(last, described),
    onNone: () => true,
  })(mounted.drawn.last);

  if (relay) {
    for (const light of mounted.lights) {
      match(light)
        .with({ _tag: P.union("Directional", "Spot") }, ({ light: lamp }) => {
          if (lamp.castShadow) lamp.shadow.needsUpdate = true;
        })
        .otherwise(() => undefined);
    }
  }

  mounted.drawn.last = Option.some(described);

  return {
    scene: mounted.graph,
    camera: mounted.camera,
    bloom: described.bloom,
    clear: mounted.clear,
  };
};

/* -------------------------------------------------------------- the stages */

/**
 * The graphs, one per kind of picture, built the first time a picture of that
 * kind is drawn and kept.
 *
 * A module-level binding because there is one of each per document and no
 * component owns it. A kind whose graph could not be built yet is asked for
 * again the next time it is drawn, because the mesh it was short arrives over
 * the network.
 */
const mounted = new Map<SceneType, Mounted>();

/** The grain, built once for every slab on the page. */
let grain: Option<Texture> = Option.none;

const grainNow = (): Texture =>
  Option.match<Texture, Texture>({
    onSome: (texture) => texture,
    onNone: () => {
      const texture = grainTexture();
      grain = Option.some(texture);

      return texture;
    },
  })(grain);

/** What every subject is built from, once the page can draw at all. */
const kitNow = (): Option<Kit> =>
  Option.map(({ environment }: { environment: Texture }): Kit => ({
    environment,
    head: meshNow(),
    grain: grainNow(),
  }))(studio());

/**
 * Draw one view, under the theme in force, and say what the frame is made of.
 *
 * `None` when nothing can be drawn yet, which leaves the canvas as it was.
 * Not re-entrant: it moves the one graph there is for this kind of picture.
 */
const frameFor = (view: View): Option<Frame> => {
  const described = scene({ theme: themeNow(), view });
  const kind = view._tag;
  const graph = mounted.get(kind);

  if (graph !== undefined) return Option.some(apply(graph, described));

  return Option.map((built: Mounted): Frame => {
    mounted.set(kind, built);

    return apply(built, described);
  })(Option.flatMap((kit: Kit) => mount(kit, described))(kitNow()));
};

/** A canvas the renderer has agreed to keep painting a color onto. */
export type SlabStage = Stage<ColorView>;

/** A canvas the renderer has agreed to keep painting a finisher's room onto. */
export type RoomStage = Stage<FinisherView>;

/**
 * Start painting a color onto a canvas, if there is anything to paint with.
 *
 * `None` means this browser has no WebGL2, which the caller answers by showing
 * the color flat — a worse picture, but the right color, which is the part
 * the shop is actually selling.
 */
export const openSlab = (canvas: HTMLCanvasElement): Option<SlabStage> =>
  openStage<ColorView>(canvas, frameFor);

/**
 * Start painting a finisher's room onto a canvas, if there is one to paint.
 *
 * `None` means no WebGL2, or a mesh that has not arrived — two answers the
 * caller gives the same reply to, by showing the still of the room that the
 * shop already has, and asking again once the mesh lands.
 */
export const openRoom = (canvas: HTMLCanvasElement): Option<RoomStage> =>
  Option.flatMap(() => openStage<FinisherView>(canvas, frameFor))(meshNow());
