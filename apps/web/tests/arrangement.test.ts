/**
 * How the mesh sits, and how a place on the floor of a walled room is written.
 *
 * The facts about the mesh are measured off the vendored file rather than
 * trusted: how far it reaches, how far it drops below its own middle once it
 * is lying back, and how high its middle then stands. The placement
 * arithmetic has to say which subject is in front and how much floor an
 * arrangement takes, for any arrangement at all.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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
  towardOf,
} from "../src/features/catalog/artwork/arrangement.ts";

/* --------------------------------------------------------------- the mesh */

/** The parts of a glTF that say where its first mesh's positions are. */
const GLTF = z.object({
  meshes: z.array(
    z.object({
      primitives: z.array(z.object({ attributes: z.object({ POSITION: z.number() }) })),
    }),
  ),
  accessors: z.array(
    z.object({
      bufferView: z.number(),
      byteOffset: z.number().optional(),
      componentType: z.number(),
      count: z.number(),
    }),
  ),
  bufferViews: z.array(z.object({ byteOffset: z.number().optional() })),
});

/** glTF's code for a 32-bit float. */
const FLOAT = 5126;

/** The vertex positions of the first mesh in a binary glTF, as triples. */
const positionsOf = (bytes: Buffer): Float32Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = GLTF.parse(
    JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))),
  );
  const primitive = json.meshes[0]?.primitives[0];

  if (primitive === undefined) throw new Error("no mesh");

  const accessor = json.accessors[primitive.attributes.POSITION];

  if (accessor === undefined) throw new Error("no positions");

  const bufferView = json.bufferViews[accessor.bufferView];

  if (bufferView === undefined) throw new Error("no buffer");

  expect(accessor.componentType).toBe(FLOAT);

  // The binary chunk follows the JSON chunk and its own eight-byte header.
  const start =
    bytes.byteOffset +
    20 +
    jsonLength +
    8 +
    (bufferView.byteOffset ?? 0) +
    (accessor.byteOffset ?? 0);

  return new Float32Array(bytes.buffer.slice(start, start + accessor.count * 3 * 4));
};

/** How the vendored mesh sits, measured off its file. */
const measured = (positions: Float32Array, tilt: number) => {
  const cosine = Math.cos(tilt);
  const sine = Math.sin(tilt);
  let reach = 0;
  let lowest = 0;
  let highest = 0;

  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    // Turned about the left-right axis, which leaves x where it was and
    // swaps height for depth.
    const lifted = y * cosine - z * sine;

    reach = Math.max(reach, Math.hypot(x, y, z));
    lowest = Math.min(lowest, lifted);
    highest = Math.max(highest, lifted);
  }

  return { reach, drop: -lowest, middle: (highest - lowest) / 2 };
};

describe("the mesh", () => {
  const positions = positionsOf(
    readFileSync(new URL("../public/suzanne.glb", import.meta.url)),
  );
  const sits = measured(positions, RESTING_TILT);

  it("has vertices to measure", () => {
    expect(positions.length).toBeGreaterThan(0);
  });

  it("reaches no further than MESH_REACH says, and not much less", () => {
    expect(MESH_REACH).toBeGreaterThanOrEqual(sits.reach);
    expect(MESH_REACH - sits.reach).toBeLessThan(0.001);
  });

  it("drops STANDING_DROP below its middle, lying at RESTING_TILT", () => {
    expect(STANDING_DROP).toBeCloseTo(sits.drop, 12);
  });

  it("stands its middle STANDING_MIDDLE high, lying at RESTING_TILT", () => {
    expect(STANDING_MIDDLE).toBeCloseTo(sits.middle, 4);
  });

  it("lies rather than leans at RESTING_TILT, on two points at once", () => {
    // Two points level with each other is where the lowest of them is
    // highest: tilted a little less it stands on one of them and a little
    // more it rolls onto the other, and either way that point goes lower.
    for (const nearby of [RESTING_TILT - 0.05, RESTING_TILT + 0.05]) {
      expect(measured(positions, nearby).drop).toBeGreaterThan(sits.drop);
    }
  });
});

/* ---------------------------------------------------------- the placement */

describe("towardOf", () => {
  it("stands a subject on the eye's own line as far in front as it is out", () => {
    // Straight down the diagonal both walls are seen from, which is where the
    // whole of a placement is in front of the middle and none of it aside.
    expect(towardOf({ x: 2, z: 2, scale: 0.5, turn: 0 })).toBeCloseTo(2 * Math.SQRT2, 12);
  });

  it("stands a subject across that line in front of nothing", () => {
    expect(towardOf({ x: 1, z: -1, scale: 0.5, turn: 0 })).toBeCloseTo(0, 12);
  });

  it("answers negative for a subject behind the middle", () => {
    expect(towardOf({ x: -1, z: -1, scale: 0.5, turn: 0 })).toBeLessThan(0);
  });
});

describe("seenFrom", () => {
  const aside = (placement: Placement): number => (placement.x - placement.z) * Math.SQRT1_2;

  it("stands a subject as far in front of the middle as asked", () => {
    for (const toward of [-1.2, 0, 0.85]) {
      expect(towardOf(seenFrom(toward, 0.3, 0.5, 0))).toBeCloseTo(toward, 12);
    }
  });

  it("stands it as far to the right of the eye's line as asked", () => {
    for (const to of [-0.7, 0, 0.4]) {
      expect(aside(seenFrom(0.5, to, 0.5, 0))).toBeCloseTo(to, 12);
    }
  });

  it("turns it to face the eye, and away from that by `facing`", () => {
    expect(seenFrom(0, 0, 0.5, 0).turn).toBe(CORNER_BEARING);
    expect(seenFrom(0, 0, 0.5, 0.24).turn).toBeCloseTo(CORNER_BEARING + 0.24, 12);
  });

  it("keeps the size it was given", () => {
    expect(seenFrom(0.85, 0.02, 0.52, 0.5).scale).toBe(0.52);
  });
});

describe("frontOf", () => {
  it("stands nobody in front of nothing", () => {
    expect(frontOf([])).toEqual({ toward: 0, reach: 0 });
  });

  it("answers for the subject furthest toward the eye", () => {
    const near: Placement = { x: 1, z: 1, scale: 0.5, turn: 0 };
    const far: Placement = { x: -1, z: -1, scale: 0.9, turn: 0 };

    expect(frontOf([far, near])).toEqual(frontOf([near, far]));
    expect(frontOf([far, near])).toEqual({
      toward: towardOf(near),
      reach: MESH_REACH * near.scale,
    });
  });

  it("answers for a lone subject wherever it stands", () => {
    const only: Placement = { x: -2, z: -2, scale: 0.3, turn: 0 };

    expect(frontOf([only])).toEqual({
      toward: towardOf(only),
      reach: MESH_REACH * only.scale,
    });
  });

  it("reaches no further than the whole arrangement does", () => {
    const standing: readonly Placement[] = [
      seenFrom(0.85, 0.02, 0.52, 0.5),
      seenFrom(-0.75, 0.7, 0.46, -0.95),
    ];
    const front = frontOf(standing);

    expect(front.toward).toBeGreaterThan(0);
    expect(front.reach).toBeGreaterThan(0);
    expect(front.reach).toBeLessThanOrEqual(reachOf(standing));
  });
});

describe("reachOf", () => {
  it("reaches nowhere with nothing to reach around", () => {
    expect(reachOf([])).toBe(0);
  });

  it("covers a subject standing away from the middle, at its own size", () => {
    expect(reachOf([{ x: 3, z: 4, scale: 0.5, turn: 0 }])).toBeCloseTo(
      5 + MESH_REACH * 0.5,
      12,
    );
  });

  it("answers for the furthest subject in the room", () => {
    const near: Placement = { x: 0.5, z: 0, scale: 0.2, turn: 0 };
    const far: Placement = { x: 0, z: 2, scale: 0.2, turn: 0 };

    expect(reachOf([near, far])).toBe(reachOf([far]));
  });
});
