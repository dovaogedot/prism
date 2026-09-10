/**
 * What a finisher's room is made of.
 *
 * The point of this function is agreement: a finisher that leaves a surface at
 * 20 and a color already at 20 have to render as the same material, or the
 * shop is demonstrating something it does not sell. So the tests compare it
 * against `surfaceFor` directly rather than against numbers written down here.
 *
 * The other half is that there is no step in it anywhere. A catalog full of
 * finishers a few points apart cannot have one of them fall on the wrong side
 * of a threshold and light its room differently from its neighbor.
 */

import {
  COATING_BOUNDS,
  COATING_ROUGHNESS_CEILING,
  EMISSION_BOUNDS,
  ROUGHNESS_BOUNDS,
  type FinishApplication,
} from "@prism/shared";
import { describe, expect, it } from "vitest";
import { roomFor, type FinisherRoom } from "../src/features/catalog/artwork/finishers.ts";
import {
  emissiveScale,
  excite,
  surfaceFor,
} from "../src/features/catalog/artwork/surfaces.ts";

/** Every neighboring pair of amounts in a range, one step apart. */
const neighbors = (
  bounds: Readonly<{ min: number; max: number }>,
  step: number,
  build: (amount: number) => FinishApplication,
): readonly (readonly [FinishApplication, FinishApplication])[] =>
  Array.from(
    { length: Math.round((bounds.max - bounds.min) / step) },
    (_, at) =>
      [build(bounds.min + at * step), build(bounds.min + (at + 1) * step)] as const,
  );

const ROUGHNESSES = neighbors(ROUGHNESS_BOUNDS, 1, (roughness) => ({
  applies: "roughness",
  roughness,
}));

const COATINGS = neighbors(COATING_BOUNDS, 1, (coatingNanometers) => ({
  applies: "coating",
  coatingNanometers,
}));

const EMISSIONS = neighbors(EMISSION_BOUNDS, 1, (emission) => ({
  applies: "emission",
  emission,
}));

/**
 * The furthest any one number a room carries moves between two of them.
 *
 * Every number is named rather than walked, so a field added to the room
 * without being added here stops being covered visibly rather than quietly.
 */
const stepBetween = (before: FinisherRoom, after: FinisherRoom): number =>
  Math.max(
    Math.abs(after.light - before.light),
    Math.abs(after.bloom.strength - before.bloom.strength),
    Math.abs(after.bloom.threshold - before.bloom.threshold),
    Math.abs(after.surface.roughness - before.surface.roughness),
    Math.abs(after.surface.metalness - before.surface.metalness),
    Math.abs(after.surface.sheen - before.surface.sheen),
    Math.abs(after.surface.clearcoat - before.surface.clearcoat),
    Math.abs(after.surface.clearcoatRoughness - before.surface.clearcoatRoughness),
    Math.abs(after.surface.iridescence - before.surface.iridescence),
    Math.abs(after.surface.coatingNanometers - before.surface.coatingNanometers),
    Math.abs(after.surface.emission - before.surface.emission),
    Math.abs(after.surface.envIntensity - before.surface.envIntensity),
    Math.abs(after.surface.relief - before.surface.relief),
  );

/** The largest step any number takes between two neighboring finishers. */
const biggestStep = (
  pairs: readonly (readonly [FinishApplication, FinishApplication])[],
  span: number,
): number =>
  pairs.reduce(
    (worst, [before, after]) =>
      Math.max(worst, stepBetween(roomFor(before), roomFor(after)) / span),
    0,
  );

describe("roomFor", () => {
  it("gives a roughness finisher the material a color at that roughness has", () => {
    for (const roughness of [5, 20, 47, 80, 95]) {
      expect(roomFor({ applies: "roughness", roughness }).surface).toEqual(
        surfaceFor({ roughness, coatingNanometers: 0, emission: 0 }),
      );
    }
  });

  it("passes a coating's thickness through untouched", () => {
    for (const coatingNanometers of [100, 237, 600]) {
      expect(
        roomFor({ applies: "coating", coatingNanometers }).surface.coatingNanometers,
      ).toBe(coatingNanometers);
    }
  });

  it("turns a coating fully on, the way a coated color is", () => {
    const { surface } = roomFor({ applies: "coating", coatingNanometers: 300 });

    expect(surface.iridescence).toBe(1);
    // A coating is the top layer; a lacquer over it would be glare.
    expect(surface.clearcoat).toBe(0);
  });

  it("stands a coating on a surface smooth enough to show one", () => {
    // Interference happens to a reflection, so the shop will not sell a coated
    // color rougher than the ceiling. A room demonstrating a coating is held
    // to the same rule, or it demonstrates something nothing in the shop is.
    const demonstrated = roomFor({
      applies: "coating",
      coatingNanometers: 300,
    }).surface;
    const roughest = surfaceFor({
      roughness: COATING_ROUGHNESS_CEILING,
      coatingNanometers: 300,
      emission: 0,
    });

    expect(demonstrated.roughness).toBeLessThan(roughest.roughness);
    // And nothing on it competes with the coating: a sheen starts well above
    // anything a coating is sold on.
    expect(demonstrated.sheen).toBe(0);
  });

  it("gives a glowing finisher the glow a color at that emission has", () => {
    for (const emission of [0, 35, 62, 100]) {
      const { surface } = roomFor({ applies: "emission", emission });
      const band = excite({ red: 90, green: 210, blue: 40 });

      expect(surface.emission).toBe(
        surfaceFor({ roughness: 60, coatingNanometers: 0, emission }).emission,
      );
      // Which is the number the material's own scalar is worked out from.
      expect(emissiveScale(surface.emission, band)).toBeGreaterThanOrEqual(0);
    }
  });

  it("dims the room as the glow gets stronger", () => {
    const faint = roomFor({ applies: "emission", emission: EMISSION_BOUNDS.min });
    const full = roomFor({ applies: "emission", emission: EMISSION_BOUNDS.max });

    expect(full.light).toBeLessThan(faint.light);
    expect(full.light).toBeGreaterThan(0);
  });

  it("lights a coating's room harder than a plain one", () => {
    // Interference is a reflection, and a reflection needs a room to be of.
    const coated = roomFor({ applies: "coating", coatingNanometers: 300 });
    const plain = roomFor({ applies: "roughness", roughness: 50 });

    expect(coated.light).toBeGreaterThan(plain.light);
  });

  it("lets nothing spill in a room whose lamps move", () => {
    for (const roughness of [5, 40, 95]) {
      expect(roomFor({ applies: "roughness", roughness }).bloom.strength).toBe(0);
    }
  });

  it("lets a glow spill, and harder the harder it glows", () => {
    const faint = roomFor({ applies: "emission", emission: 35 });
    const full = roomFor({ applies: "emission", emission: 100 });

    expect(full.bloom.strength).toBeGreaterThan(faint.bloom.strength);
  });

  it("has no step in it anywhere, on any of the three", () => {
    // A point of roughness or of glow is about 1% of its range and a
    // nanometer is 0.2% of its own, so nothing may move more than a few
    // percent of its own scale between two neighboring finishers.
    expect(biggestStep(ROUGHNESSES, 1)).toBeLessThan(0.05);
    expect(biggestStep(EMISSIONS, 1)).toBeLessThan(0.05);
    expect(biggestStep(COATINGS, COATING_BOUNDS.max)).toBeLessThan(0.05);
  });
});
