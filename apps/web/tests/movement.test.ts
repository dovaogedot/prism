/**
 * What the pointer has done to a finisher's room.
 *
 * Three rooms with three different things moving in them, driven through one
 * set of functions — so what has to hold is that they behave alike: each one
 * starts still, travels only toward where it was aimed, arrives, and comes
 * home. The numbers each of them travels in are `orbit`, `lightring` and
 * `hueshift`, which have their own tests.
 */

import type { FinishApplication } from "@prism/shared";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";
import type { FinisherView } from "../src/features/catalog/artwork/finisher-scene.ts";
import {
  advanced,
  aimedAt,
  atRest,
  released,
  stilled,
  stopped,
  viewOf,
  type Movement,
} from "../src/features/catalog/artwork/movement.ts";

const STAGE = { width: 200, height: 200 };
const LEFT = { x: 0, y: 100 };
const RIGHT = { x: 200, y: 100 };
const MIDDLE = { x: 100, y: 100 };

const ROUGH: FinishApplication = { applies: "roughness", roughness: 30 };
const GLOW: FinishApplication = { applies: "emission", emission: 70 };
const COAT: FinishApplication = { applies: "coating", coatingNanometers: 420 };

const EVERY: readonly FinishApplication[] = [ROUGH, GLOW, COAT];

/** Long enough for an exponential approach to have arrived by any measure. */
const A_WHILE = 30;

/** A room aimed at one corner and left to travel there. */
const travelled = (application: FinishApplication): Movement =>
  advanced(aimedAt(atRest(application), RIGHT, STAGE), A_WHILE);

/** Every number one picture is made of, in the order the picture holds them. */
const numbersIn = (view: FinisherView): readonly number[] =>
  match(view)
    .with({ applies: "roughness" }, ({ roughness, lamps }) => [
      roughness,
      ...lamps.flatMap(({ at, lag }) => [at.x, at.y, at.z, lag]),
    ])
    .with({ applies: "emission" }, ({ emission, orbit }) => [
      emission,
      orbit.azimuth,
      orbit.elevation,
    ])
    .with({ applies: "coating" }, ({ coatingNanometers, hueOffset }) => [
      coatingNanometers,
      hueOffset,
    ])
    .exhaustive();

describe("atRest", () => {
  it("starts every room already where it is going", () => {
    for (const application of EVERY) expect(stilled(atRest(application))).toBe(true);
  });

  it("keeps the room it was told to show", () => {
    for (const application of EVERY) {
      expect(atRest(application).applies).toBe(application.applies);
    }
  });
});

describe("aimedAt", () => {
  it("gives every room somewhere to travel to", () => {
    for (const application of EVERY) {
      expect(stilled(aimedAt(atRest(application), RIGHT, STAGE))).toBe(false);
    }
  });

  it("leaves an orbiting room where the middle of the stage already puts it", () => {
    for (const application of [ROUGH, GLOW]) {
      expect(stilled(aimedAt(atRest(application), MIDDLE, STAGE))).toBe(true);
    }
  });

  it("leaves a coated room where the left edge already puts it", () => {
    expect(stilled(aimedAt(atRest(COAT), LEFT, STAGE))).toBe(true);
  });

  it("moves nothing by itself", () => {
    for (const application of EVERY) {
      const still = atRest(application);
      const aimed = aimedAt(still, RIGHT, STAGE);

      expect(viewOf(aimed)).toStrictEqual(viewOf(still));
    }
  });

  it("changes nothing about the movement it was handed", () => {
    for (const application of EVERY) {
      const still = atRest(application);
      const before = structuredClone(still);

      aimedAt(still, RIGHT, STAGE);

      expect(still).toStrictEqual(before);
    }
  });
});

describe("advanced", () => {
  it("arrives, given enough time", () => {
    for (const application of EVERY) expect(stilled(travelled(application))).toBe(true);
  });

  it("has not arrived after one frame of it", () => {
    for (const application of EVERY) {
      const aimed = aimedAt(atRest(application), RIGHT, STAGE);

      expect(stilled(advanced(aimed, 1 / 60))).toBe(false);
    }
  });

  it("moves nothing at all in no time", () => {
    for (const application of EVERY) {
      const aimed = aimedAt(atRest(application), RIGHT, STAGE);

      expect(viewOf(advanced(aimed, 0))).toStrictEqual(viewOf(aimed));
    }
  });

  it("changes nothing about the movement it was handed", () => {
    for (const application of EVERY) {
      const aimed = aimedAt(atRest(application), RIGHT, STAGE);
      const before = structuredClone(aimed);

      advanced(aimed, 1 / 60);

      expect(aimed).toStrictEqual(before);
    }
  });
});

describe("released", () => {
  it("sends every room somewhere it can arrive at", () => {
    for (const application of EVERY) {
      expect(stilled(advanced(released(travelled(application)), A_WHILE))).toBe(true);
    }
  });

  it("brings an orbiting room back to where it opened", () => {
    for (const application of [ROUGH, GLOW]) {
      const home = advanced(released(travelled(application)), A_WHILE);

      expect(viewOf(stopped(home))).toStrictEqual(viewOf(atRest(application)));
    }
  });

  it("finishes a coated room's turn rather than unwinding all of it", () => {
    // The right edge is a full turn, which is the same colors the room opened
    // with — so there is nothing left to travel, and nothing travels.
    expect(stilled(released(travelled(COAT)))).toBe(true);
  });
});

describe("stopped", () => {
  it("has arrived, whatever was still moving", () => {
    for (const application of EVERY) {
      const aimed = aimedAt(atRest(application), RIGHT, STAGE);

      expect(stilled(stopped(aimed))).toBe(true);
    }
  });

  it("lands where travelling was heading anyway", () => {
    // To nine digits rather than to all of them: exponential travel converges
    // on its target instead of reaching it, so the two roads to the same place
    // agree on everything a reader could see and not on the last bit.
    for (const application of EVERY) {
      const aimed = aimedAt(atRest(application), RIGHT, STAGE);
      const flown = advanced(aimed, A_WHILE);

      expect(numbersIn(viewOf(flown))).toEqual(
        numbersIn(viewOf(stopped(aimed))).map((number) => expect.closeTo(number, 9)),
      );
    }
  });
});

describe("viewOf", () => {
  it("draws the room it was given, carrying the amount that room demonstrates", () => {
    expect(viewOf(atRest(ROUGH))).toMatchObject({ applies: "roughness", roughness: 30 });
    expect(viewOf(atRest(GLOW))).toMatchObject({ applies: "emission", emission: 70 });
    expect(viewOf(atRest(COAT))).toMatchObject({
      applies: "coating",
      coatingNanometers: 420,
    });
  });

  it("carries nothing about the product but the amount it is sold with", () => {
    // The paint on the subjects belongs to the room they stand in, so there is
    // nothing else about a product for a picture to carry.
    for (const application of EVERY) {
      expect(Object.keys(viewOf(atRest(application)))).not.toContain("seed");
    }
  });
});
