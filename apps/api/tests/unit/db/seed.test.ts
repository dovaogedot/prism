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

describe("Seed.imageSvg", () => {
  it("drops markup characters from the name", () => {
    const svg = Seed.imageSvg('<b>"Lamp" & Co</b>', "#123456");

    expect(svg).toContain(">bLamp  Co/b<");
    expect(svg).toContain('fill="#123456"');
  });
});

describe("Seed.categories", () => {
  it("names each category once and gives each its own properties", () => {
    const shelves = Seed.categories();
    const names = shelves.map((shelf) => shelf.name);

    expect(new Set(names).size).toBe(names.length);

    for (const shelf of shelves) {
      const properties = Object.entries(shelf.properties);
      expect(properties.length, shelf.name).toBeGreaterThanOrEqual(2);

      for (const [name, draw] of properties) {
        expect(draw().length, `${shelf.name}.${name}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives two categories different vocabularies", () => {
    const [first, second] = Seed.categories();
    if (first === undefined || second === undefined) throw new Error("expected two categories");

    expect(Object.keys(first.properties)).not.toEqual(Object.keys(second.properties));
  });
});
