/**
 * Suzanne, the shape every finisher is demonstrated on.
 *
 * A finisher has no color and no form of its own — it is something done to a
 * surface — so it is shown on a form that everyone already reads as an object
 * rather than as a swatch. One shape for all three effects, so what changes
 * between two finishers is only the finish.
 *
 * The geometry is Blender's Suzanne, taken from the Khronos glTF sample
 * assets, released under CC0 1.0 Universal by UX3D, © 2017 Norbert Nopper. It
 * is vendored at `apps/web/public/suzanne.glb`, stripped to positions, normals
 * and indices — no UVs, no materials, no textures — which is 2 012 vertices,
 * 3 936 triangles and 72 796 bytes. Having no UVs is what stops the rooms
 * putting a grain map on the surface the way the color slab does.
 *
 * In the vendored orientation the face looks along +z and the widest axis is
 * the ears at ±1.33691. Nothing in a room stands in that orientation: every
 * subject is tilted onto its back first, and how far the tilted shape then has
 * to be lifted to rest on the floor is read off the vertices by `restingOf`.
 *
 * One geometry for the document, loaded once and never given back: three rooms
 * and a page of stages all draw the same one, and nothing on the page outlives
 * it.
 */

import { Option } from "@prism/shared";
import { type BufferGeometry, Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Where the vendored mesh is served from. */
const MESH_URL = "/suzanne.glb";

/** The geometry, once it has arrived. */
let theMesh: Option<BufferGeometry> = Option.none;

/** Whether the fetch has been started, so a page of stages starts one of them. */
let asked = false;

/** Who is to be told when it arrives. Emptied by the telling. */
const waiting = new Set<() => void>();

/**
 * The first mesh in a loaded file.
 *
 * The vendored file holds exactly one, but the search is over whatever arrived
 * rather than over what is expected — a file with no mesh in it is absence,
 * which every caller already draws a still picture for.
 */
const geometryIn = (root: Object3D): Option<BufferGeometry> => {
  let found: Option<BufferGeometry> = Option.none;

  root.traverse((object) => {
    if (Option.isNone(found) && object instanceof Mesh) {
      found = Option.some(object.geometry);
    }
  });

  return found;
};

const arrive = (geometry: BufferGeometry): void => {
  theMesh = Option.some(geometry);

  for (const told of waiting) told();
  waiting.clear();
};

const fetchMesh = (): void => {
  new GLTFLoader().load(
    MESH_URL,
    (loaded) =>
      Option.match<BufferGeometry, void>({
        onSome: arrive,
        onNone: () => undefined,
      })(geometryIn(loaded.scene)),
    () => undefined,
    // A mesh that will not load leaves every room unbuilt, which is the same
    // answer a browser with no WebGL2 gets, and has the same still picture.
    () => undefined,
  );
};

/**
 * The geometry, if it is here yet.
 *
 * `None` before the fetch lands and if the fetch fails. A caller answers both
 * the same way, by drawing its still picture.
 */
export const meshNow = (): Option<BufferGeometry> => theMesh;

/**
 * Ask for the mesh, and be told once when it arrives.
 *
 * Starts the fetch on the first call and never again. A subscriber added after
 * the mesh is already here is not called — it is already true, and
 * `meshNow` is where a caller reads it. Returns the function that withdraws
 * the request.
 */
export const whenMesh = (arrives: () => void): (() => void) => {
  if (!asked) {
    asked = true;
    fetchMesh();
  }

  waiting.add(arrives);

  return () => {
    waiting.delete(arrives);
  };
};
