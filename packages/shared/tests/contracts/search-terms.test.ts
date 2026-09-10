import { describe, expect, it } from "vitest";
import { resolveSearchTerm, singular } from "../../src/index.ts";

describe("singular", () => {
  it("drops a plain plural", () => {
    expect(singular("golds")).toBe("gold");
    expect(singular("crimsons")).toBe("crimson");
    expect(singular("blues")).toBe("blue");
  });

  it("turns -ies back into -y", () => {
    expect(singular("navies")).toBe("navy");
  });

  it("drops -es after a sibilant", () => {
    expect(singular("blushes")).toBe("blush");
    expect(singular("mosses")).toBe("moss");
  });

  it("leaves a singular alone", () => {
    expect(singular("gold")).toBe("gold");
    expect(singular("iridescent")).toBe("iridescent");
  });

  it("does not mistake -ss for a plural", () => {
    // The whole reason the rule checks for it: "roughness" is a finish, and
    // "roughnes" is nothing at all.
    expect(singular("roughness")).toBe("roughness");
  });

  it("is case-insensitive", () => {
    expect(singular("Golds")).toBe("gold");
  });
});

describe("resolveSearchTerm", () => {
  it("reads a category name, in either number", () => {
    expect(resolveSearchTerm("shifters")).toEqual({
      kind: "category",
      category: "shifter",
    });
    expect(resolveSearchTerm("Finisher")).toEqual({
      kind: "category",
      category: "finisher",
    });
  });

  it("reads a finish name as the finish filter", () => {
    expect(resolveSearchTerm("roughness")).toEqual({
      kind: "finish",
      finish: "roughness",
    });
    expect(resolveSearchTerm("Iridescent")).toEqual({
      kind: "finish",
      finish: "iridescent",
    });
  });

  it("reads a direction however it is spelled", () => {
    for (const term of ["cw", "CW", "clockwise", "clock-wise"]) {
      expect(resolveSearchTerm(term), term).toEqual({
        kind: "direction",
        direction: "cw",
      });
    }

    for (const term of ["ccw", "counter-clockwise", "anticlockwise"]) {
      expect(resolveSearchTerm(term), term).toEqual({
        kind: "direction",
        direction: "ccw",
      });
    }
  });

  it("reads a color family, in either number", () => {
    expect(resolveSearchTerm("gold")).toEqual({ kind: "family", family: "gold" });
    expect(resolveSearchTerm("Golds")).toEqual({ kind: "family", family: "gold" });
    expect(resolveSearchTerm("navies")).toEqual({ kind: "family", family: "navy" });
  });

  it("leaves anything else as free text", () => {
    expect(resolveSearchTerm("  screaming ")).toEqual({
      kind: "text",
      text: "screaming",
    });
  });

  it("prefers a category over anything else of the same name", () => {
    // The coarsest reading wins: somebody typing "color" wants the shelf.
    expect(resolveSearchTerm("color")).toEqual({ kind: "category", category: "color" });
  });

  it("resolves every family the database can name", async () => {
    // The vocabulary here and the landmark list in `color_family` are the same
    // set, so a family the database can return is one a shopper can type.
    const { COLOR_FAMILIES } = await import("../../src/index.ts");

    for (const family of COLOR_FAMILIES) {
      expect(resolveSearchTerm(family), family).toEqual({ kind: "family", family });
    }
  });
});
