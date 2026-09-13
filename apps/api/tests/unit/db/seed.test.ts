import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Seed } from "../../../src/db/seed.ts";

describe("Seed.slugOf", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(Seed.slugOf("Nader - Dibbert", new Set())).toBe("nader-dibbert");
    expect(Seed.slugOf("  Awesome Bronze Tuna! ", new Set())).toBe("awesome-bronze-tuna");
  });

  it("suffixes a slug that is already taken, counting up", () => {
    const taken = new Set<string>();

    expect(Seed.slugOf("Hat", taken)).toBe("hat");
    expect(Seed.slugOf("Hat", taken)).toBe("hat-2");
    expect(Seed.slugOf("hat", taken)).toBe("hat-3");
    expect([...taken]).toEqual(["hat", "hat-2", "hat-3"]);
  });

  it("falls back to a word when nothing in the name survives", () => {
    expect(Seed.slugOf("???", new Set())).toBe("item");
  });
});

describe("Seed.catalog", () => {
  it("holds every category with products that each have a type and a picture on disk", async () => {
    const catalog = await Seed.catalog();

    expect(catalog.categories.length).toBeGreaterThan(0);

    for (const shelf of catalog.categories) {
      expect(shelf.products.length, shelf.name).toBeGreaterThan(0);

      for (const product of shelf.products) {
        expect(product.properties["type"], product.name).toBeTruthy();
        await expect(access(new URL(`media/${product.image}`, Seed.CATALOG_DIR)), product.image).resolves.toBeUndefined();
      }
    }
  });
});
