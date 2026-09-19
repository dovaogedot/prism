import { describe, expect, it } from "vitest";
import { Seed } from "../seed.ts";

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
