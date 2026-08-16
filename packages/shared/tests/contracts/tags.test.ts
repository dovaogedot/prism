import { describe, expect, it } from "vitest";
import {
  Option,
  resolveSearchTerm,
  singular,
  tagChain,
  type TagFacetBucket,
} from "../../src/index.ts";

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
    expect(singular("matte")).toBe("matte");
  });

  it("does not mistake -ss for a plural", () => {
    // The whole reason the rule checks for it: "gloss" is a finish, and
    // "glos" is nothing at all.
    expect(singular("gloss")).toBe("gloss");
  });

  it("is case-insensitive", () => {
    expect(singular("Golds")).toBe("gold");
  });
});

describe("resolveSearchTerm", () => {
  const tags = ["yellow", "gold", "navy"];

  it("reads a finish name as the finish filter", () => {
    expect(resolveSearchTerm("gloss", tags)).toEqual({
      kind: "finish",
      finish: "gloss",
    });
  });

  it("reads a tag name as the tag filter", () => {
    expect(resolveSearchTerm("gold", tags)).toEqual({ kind: "tag", slug: "gold" });
  });

  it("accepts the plural a shopper is more likely to type", () => {
    expect(resolveSearchTerm("Golds", tags)).toEqual({ kind: "tag", slug: "gold" });
    expect(resolveSearchTerm("navies", tags)).toEqual({ kind: "tag", slug: "navy" });
  });

  it("leaves anything else as free text", () => {
    expect(resolveSearchTerm("  screaming ", tags)).toEqual({
      kind: "text",
      text: "screaming",
    });
  });

  it("resolves a category name, in either number", () => {
    expect(resolveSearchTerm("shifters", tags)).toEqual({
      kind: "category",
      category: "shifter",
    });
    expect(resolveSearchTerm("Finisher", tags)).toEqual({
      kind: "category",
      category: "finisher",
    });
  });

  it("prefers a category over a tag of the same name", () => {
    // The coarsest reading wins: somebody typing "color" wants the shelf.
    expect(resolveSearchTerm("color", ["color"])).toEqual({
      kind: "category",
      category: "color",
    });
  });

  it("prefers a finish over a tag of the same name", () => {
    // Nothing collides today; this pins the precedence if something ever does.
    expect(resolveSearchTerm("matte", ["matte"])).toEqual({
      kind: "finish",
      finish: "matte",
    });
  });
});

describe("tagChain", () => {
  const bucket = (
    value: string,
    label: string,
    parent: string | undefined,
    depth: number,
  ): TagFacetBucket => ({
    value,
    label,
    count: 1,
    parentSlug: Option.fromNullable(parent),
    depth,
    kind: "color",
  });

  const categories: readonly TagFacetBucket[] = [
    bucket("yellow", "Yellow", undefined, 0),
    bucket("gold", "Gold", "yellow", 1),
    bucket("blue", "Blue", undefined, 0),
  ];

  it("returns the ancestors outermost first", () => {
    expect(tagChain(categories, "gold").map((tag) => tag.value)).toEqual([
      "yellow",
      "gold",
    ]);
  });

  it("returns just the root for a root category", () => {
    expect(tagChain(categories, "blue").map((tag) => tag.value)).toEqual(["blue"]);
  });

  it("returns nothing for a slug the tree does not have", () => {
    expect(tagChain(categories, "vermilion")).toEqual([]);
  });
});
