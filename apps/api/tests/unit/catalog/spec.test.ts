/**
 * `toProductSpec` is the seam between a table full of nullable columns and a
 * domain where absence is not representable. These pin both halves: that a
 * well-formed row of each kind comes back whole, and that a row the variant
 * constraint could not have produced comes back as nothing rather than as a
 * product with holes in it.
 */

import { describe, expect, it } from "vitest";
import { Option } from "@prism/shared";
import { toProductSpec, type SpecColumns } from "../../../src/modules/catalog/spec.ts";

/** Every column null, so each case below names only what it needs. */
const empty: SpecColumns = {
  kind: "color",
  hex: null,
  finish: null,
  hue: null,
  saturation: null,
  lightness: null,
  durability: null,
  arcDegrees: null,
  direction: null,
};

const color: SpecColumns = {
  ...empty,
  kind: "color",
  hex: "#ff8800",
  finish: "gloss",
  hue: 32,
  saturation: 100,
  lightness: 50,
};

const finisher: SpecColumns = {
  ...empty,
  kind: "finisher",
  finish: "matte",
  durability: 12,
};

const shifter: SpecColumns = {
  ...empty,
  kind: "shifter",
  direction: "cw",
  arcDegrees: 90,
};

describe("toProductSpec", () => {
  it("builds a color from its hex, finish and three channels", () => {
    expect(toProductSpec(color)).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("builds a finisher from its finish and durability", () => {
    expect(toProductSpec(finisher)).toEqual(
      Option.some({ kind: "finisher", finish: "matte", durability: 12 }),
    );
  });

  it("builds a shifter from its direction and arc", () => {
    expect(toProductSpec(shifter)).toEqual(
      Option.some({ kind: "shifter", direction: "cw", arcDegrees: 90 }),
    );
  });

  it("carries nothing from the other variants' columns", () => {
    // A row that somehow held a shifter's arc alongside a color would still
    // produce a plain color: the spec is built from the branch, not the row.
    expect(toProductSpec({ ...color, arcDegrees: 90, direction: "ccw" })).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 32,
        saturation: 100,
        lightness: 50,
      }),
    );
  });

  it("keeps a zero arc and a zero channel, which are values and not absence", () => {
    expect(toProductSpec({ ...color, hue: 0, lightness: 0 })).toEqual(
      Option.some({
        kind: "color",
        hex: "#ff8800",
        finish: "gloss",
        hue: 0,
        saturation: 100,
        lightness: 0,
      }),
    );
  });

  it("refuses a color with no hex", () => {
    expect(toProductSpec({ ...color, hex: null })).toEqual(Option.none);
  });

  it("refuses a color missing a derived channel", () => {
    expect(toProductSpec({ ...color, saturation: null })).toEqual(Option.none);
  });

  it("refuses a finisher with no durability", () => {
    expect(toProductSpec({ ...finisher, durability: null })).toEqual(Option.none);
  });

  it("refuses a shifter with no direction", () => {
    expect(toProductSpec({ ...shifter, direction: null })).toEqual(Option.none);
  });

  it("refuses a row with a kind and nothing else", () => {
    expect(toProductSpec(empty)).toEqual(Option.none);
    expect(toProductSpec({ ...empty, kind: "finisher" })).toEqual(Option.none);
    expect(toProductSpec({ ...empty, kind: "shifter" })).toEqual(Option.none);
  });
});
