import { FINISH_AXES, FINISH_BANDS } from "@prism/shared";
import { describe, expect, it } from "vitest";
import {
  type FacetState,
  railControls,
  withoutHidden,
} from "../src/features/catalog/filters.ts";

/** Nothing set, which is the catalog as it first opens. */
const NOTHING: FacetState = {
  category: "",
  family: "",
  brands: [],
  finish: [],
  direction: "",
  arcMin: "",
  arcMax: "",
  minRating: "",
  priceMin: "",
  priceMax: "",
  hueMin: "",
  hueMax: "",
  saturationMin: "",
  saturationMax: "",
  lightnessMin: "",
  lightnessMax: "",
  roughnessMin: "",
  roughnessMax: "",
  coatingMin: "",
  coatingMax: "",
  emissionMin: "",
  emissionMax: "",
};

/** The filters every category shares, set. */
const SHARED: Pick<FacetState, "brands" | "minRating" | "priceMin" | "priceMax"> = {
  brands: ["chroma-labs"],
  minRating: "4",
  priceMin: "1000",
  priceMax: "5000",
};

/** Every filter set, each inside the stretch its finish names, on no shelf yet. */
const EVERYTHING: FacetState = {
  ...SHARED,
  category: "",
  family: "gold",
  finish: ["roughness", "iridescent", "fluorescent"],
  direction: "cw",
  arcMin: "90",
  arcMax: "180",
  hueMin: "0",
  hueMax: "60",
  saturationMin: "20",
  saturationMax: "80",
  lightnessMin: "20",
  lightnessMax: "80",
  roughnessMin: "10",
  roughnessMax: "90",
  coatingMin: "200",
  coatingMax: "500",
  emissionMin: "40",
  emissionMax: "90",
};

describe("railControls", () => {
  it("offers only the shared filters while no category is chosen", () => {
    expect(railControls(NOTHING)).toEqual({
      colors: false,
      finishers: false,
      shifters: false,
      amounts: [],
    });
  });

  it("gives the colors their controls, with every amount over its whole axis", () => {
    expect(railControls({ category: "color", finish: ["iridescent"] })).toEqual({
      colors: true,
      finishers: false,
      shifters: false,
      amounts: [
        { property: "roughness", range: FINISH_AXES.roughness },
        { property: "coating", range: FINISH_AXES.coating },
        { property: "emission", range: FINISH_AXES.emission },
      ],
    });
  });

  it("gives the shifters theirs, and no amount", () => {
    expect(railControls({ category: "shifter", finish: ["iridescent"] })).toEqual({
      colors: false,
      finishers: false,
      shifters: true,
      amounts: [],
    });
  });

  it("gives the finishers a slider for each finish ticked, over the stretch it names", () => {
    expect(railControls({ category: "finisher", finish: [] })).toEqual({
      colors: false,
      finishers: true,
      shifters: false,
      amounts: [],
    });
    expect(
      railControls({ category: "finisher", finish: ["fluorescent", "iridescent"] }).amounts,
    ).toEqual([FINISH_BANDS.iridescent, FINISH_BANDS.fluorescent]);
  });

  it("offers no slider for a finish it does not know", () => {
    expect(railControls({ category: "finisher", finish: ["glitter"] }).amounts).toEqual([]);
  });
});

describe("withoutHidden", () => {
  it("keeps what the colors show, and clears the rest", () => {
    expect(withoutHidden({ ...EVERYTHING, category: "color" })).toEqual({
      ...EVERYTHING,
      category: "color",
      finish: [],
      direction: "",
      arcMin: "",
      arcMax: "",
    });
  });

  it("keeps what the finishers show, and clears the rest", () => {
    expect(withoutHidden({ ...EVERYTHING, category: "finisher" })).toEqual({
      ...EVERYTHING,
      category: "finisher",
      family: "",
      hueMin: "",
      hueMax: "",
      saturationMin: "",
      saturationMax: "",
      lightnessMin: "",
      lightnessMax: "",
      direction: "",
      arcMin: "",
      arcMax: "",
    });
  });

  it("keeps what the shifters show, and clears the rest", () => {
    expect(withoutHidden({ ...EVERYTHING, category: "shifter" })).toEqual({
      ...NOTHING,
      ...SHARED,
      category: "shifter",
      direction: "cw",
      arcMin: "90",
      arcMax: "180",
    });
  });

  it("clears the range on the amount of a finish that is not ticked", () => {
    const glowing = withoutHidden({ ...EVERYTHING, category: "finisher", finish: ["fluorescent"] });

    expect([glowing.roughnessMin, glowing.roughnessMax]).toEqual(["", ""]);
    expect([glowing.coatingMin, glowing.coatingMax]).toEqual(["", ""]);
    expect([glowing.emissionMin, glowing.emissionMax]).toEqual(["40", "90"]);
  });

  it("clears an end of a range its slider cannot reach", () => {
    // The colors' coating slider starts at bare paint, and the finishers'
    // where a coating starts to show.
    const coated = withoutHidden({
      ...EVERYTHING,
      category: "finisher",
      finish: ["iridescent"],
      coatingMin: "50",
    });

    expect([coated.coatingMin, coated.coatingMax]).toEqual(["", "500"]);
  });

  it("clears everything but the shared filters while no category is chosen", () => {
    expect(withoutHidden(EVERYTHING)).toEqual({ ...NOTHING, ...SHARED });
  });
});
