import { describe, expect, it } from "vitest";
import { STILL_ANGLES, stillPath } from "../../src/contracts/stills.ts";

describe("STILL_ANGLES", () => {
  it("opens where the live scene opens", () => {
    expect(STILL_ANGLES[0]).toMatchObject({ aroundDegrees: 0, upDegrees: 0 });
  });

  it("names every angle differently, so no two stills share a file", () => {
    const names = STILL_ANGLES.map((angle) => angle.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("never looks from below where the eye rests", () => {
    for (const angle of STILL_ANGLES) expect(angle.upDegrees).toBeGreaterThanOrEqual(0);
  });
});

describe("stillPath", () => {
  it("files a still under its product, its angle and its theme", () => {
    expect(stillPath("void-black", STILL_ANGLES[0], "dark")).toBe("void-black/front-dark.webp");
  });
});
