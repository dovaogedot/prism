/**
 * The room the slab reflects.
 *
 * A gloss face is a picture of its surroundings, so a scene with lights and no
 * surroundings gives it nothing to be a picture of — a lit slab against an
 * empty environment reads as plastic. This builds the surroundings: a dark
 * shell with a few bright panels in it, which `PMREMGenerator` turns into the
 * environment map every material samples.
 *
 * It is never rendered. Only its convolution is.
 */

import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from "three";

/**
 * How far the strip lamp leans, in radians.
 *
 * Shared with the real light in the scene, so the reflection the shopper sees
 * and the light that actually falls on the slab are the same lamp.
 */
export const STRIP_LEAN = -0.62;

/**
 * A panel of light: where it is, how big, how bright, and what color.
 *
 * The intensity is radiance, not power — how bright the panel's surface is
 * rather than how much light it puts out — so making a panel longer makes the
 * whole room brighter unless this comes down with it.
 */
type Panel = Readonly<{
  position: readonly [number, number, number];
  size: readonly [number, number];
  color: number;
  intensity: number;
  /** Radians about the panel's own facing direction. */
  lean: number;
}>;

/**
 * Everything is in the hemisphere the camera sits in, because that is the half
 * of the room a face turned toward the camera can show.
 */
const PANELS: readonly Panel[] = [
  // The strip lamp. Long, thin and leaning, which is the reflection the whole
  // thing is built around — and thin is the operative word: a lacquered face
  // is a mirror, so the reflection is the shape of the lamp, and a lamp that
  // is a hand's width across covers half the slab in white.
  //
  // Thin and bright rather than broad and dim, at the same total power: a
  // lacquered face mirrors the lamp, so what it returns is the lamp's own
  // brightness, while what the room is lit to is the lamp's area. Trading one
  // for the other buys a strip that reads without a wall that glares.
  //
  // Nearly on the camera's own axis, which is not a stylistic choice but the
  // only place it can go. A flat face reflects whatever is directly behind the
  // viewer, and the face spans about seven degrees of the reflection; a lamp
  // further round than that cannot appear on a slab standing square on, at any
  // brightness. Off the axis by eight degrees or so, and leaning, the strip
  // lies across one corner at rest and sweeps off the far edge on the turn —
  // which is both the device-demo look and, more to the point, the difference
  // between gloss and matte in a grid nobody has hovered yet.
  {
    position: [-0.44, 0.4, 4.3],
    size: [34, 0.4],
    color: 0xffffff,
    intensity: 1.9,
    lean: STRIP_LEAN,
  },
  // A wide, cool, much dimmer panel opposite it, so the unlit half of a gloss
  // face is dark rather than black.
  {
    position: [3.4, 0.6, 2.6],
    size: [5, 4],
    color: 0xc8d6ff,
    intensity: 0.4,
    lean: 0,
  },
  // Warm bounce off the floor, which keeps the bottom edge from dying.
  {
    position: [0, -3.2, 2.4],
    size: [6, 2.4],
    color: 0xffe6c8,
    intensity: 0.3,
    lean: 0,
  },
];


/**
 * How dark the room is where no panel lights it.
 *
 * Not black. A lacquered face is a mirror, and a mirror of a black room is a
 * face with no reflection in it — which is a face that looks matte until it
 * happens to catch the strip.
 */
const SHELL = 0x1a1a20;

/** Big enough that no panel reaches its walls and is cut off by them. */
const SHELL_SIZE = 40;

/**
 * A fresh room. The caller owns it: `PMREMGenerator.fromScene` reads it once,
 * after which nothing in it is needed again.
 */
export const buildRoom = (): Scene => {
  const room = new Scene();

  room.add(
    new Mesh(
      new BoxGeometry(SHELL_SIZE, SHELL_SIZE, SHELL_SIZE),
      new MeshBasicMaterial({ color: SHELL, side: BackSide }),
    ),
  );

  for (const panel of PANELS) {
    const material = new MeshBasicMaterial({
      // Basic materials are not lit, so the intensity has to be in the color.
      color: new Color().setHex(panel.color, SRGBColorSpace).multiplyScalar(panel.intensity),
    });

    const mesh = new Mesh(new PlaneGeometry(panel.size[0], panel.size[1]), material);
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    mesh.lookAt(0, 0, 0);
    // After `lookAt`, the panel's local Z points at the slab, so turning about
    // it spins the panel in its own plane without aiming it anywhere else.
    mesh.rotateZ(panel.lean);

    room.add(mesh);
  }

  return room;
};
