/**
 * How far round the wheel a coating's colors have been carried.
 *
 * The one property that has to hold is that both edges of the stage show the
 * same colors: a full turn is a full turn, so there is no seam for the room to
 * jump across when a finger crosses the middle of it and back.
 */

import { describe, expect, it } from "vitest";
import { SETTLED_RADIANS } from "../src/features/catalog/artwork/ease.ts";
import {
  hueOffsetAt,
  hueShifted,
  SETTLED_DEGREES,
  unturned,
} from "../src/features/catalog/artwork/hueshift.ts";

const STAGE = { width: 200, height: 200 };

const at = (x: number): number => hueOffsetAt({ x, y: 100 }, STAGE);

describe("hueOffsetAt", () => {
  it("starts at nothing on the left edge and reaches a full turn on the right", () => {
    expect(at(0)).toBe(0);
    expect(at(200)).toBe(360);
  });

  it("is half a turn half way across", () => {
    expect(at(100)).toBe(180);
  });

  it("only ever grows as the pointer goes right", () => {
    let last = -1;

    for (let x = 0; x <= 200; x += 5) {
      expect(at(x)).toBeGreaterThan(last);
      last = at(x);
    }
  });

  it("shows the same colors at both edges", () => {
    expect(hueShifted(40, at(0))).toBe(hueShifted(40, at(200)));
  });

  it("stops at the edges once the pointer leaves the stage", () => {
    expect(at(-500)).toBe(at(0));
    expect(at(700)).toBe(at(200));
  });

  it("has nowhere to travel on a stage with no width", () => {
    expect(hueOffsetAt({ x: 5, y: 5 }, { width: 0, height: 200 })).toBe(0);
  });
});

describe("hueShifted", () => {
  it("leaves a hue where it was when nothing has been carried", () => {
    expect(hueShifted(200, 0)).toBe(200);
  });

  it("brings a carried hue back inside one turn", () => {
    expect(hueShifted(350, 30)).toBe(20);
    expect(hueShifted(350, 730)).toBe(0);
  });

  it("carries a hue backwards round the wheel rather than off it", () => {
    expect(hueShifted(10, -30)).toBe(340);
  });

  it("keeps every result on the wheel, however far anything is carried", () => {
    for (let hue = 0; hue < 360; hue += 17) {
      for (let offset = -1080; offset <= 1080; offset += 37) {
        const shifted = hueShifted(hue, offset);

        expect(shifted).toBeGreaterThanOrEqual(0);
        expect(shifted).toBeLessThan(360);
      }
    }
  });

  it("holds the interval between two hues as both are carried", () => {
    // Which is what makes a room of coated subjects shift together rather
    // than drift apart.
    for (let offset = 0; offset <= 360; offset += 15) {
      const gap = (hueShifted(200, offset) - hueShifted(80, offset) + 360) % 360;

      expect(gap).toBeCloseTo(120, 10);
    }
  });
});

describe("SETTLED_DEGREES", () => {
  it("is the distance the rest of the site calls arrived, in degrees", () => {
    expect((SETTLED_DEGREES * Math.PI) / 180).toBeCloseTo(SETTLED_RADIANS, 12);
  });

  it("is under a twentieth of a degree, which no display resolves", () => {
    expect(SETTLED_DEGREES).toBeLessThan(0.05);
    expect(SETTLED_DEGREES).toBeGreaterThan(0);
  });
});

describe("unturned", () => {
  it("has nowhere to go from a room that was never carried", () => {
    expect(unturned(0)).toBe(0);
  });

  it("finishes a turn that is nearly done rather than undoing it", () => {
    expect(unturned(360)).toBe(360);
    expect(unturned(300)).toBe(360);
  });

  it("undoes a turn that has barely started", () => {
    expect(unturned(60)).toBe(0);
  });

  it("never asks for more than half a turn of travel", () => {
    for (let offset = 0; offset <= 360; offset += 3) {
      expect(Math.abs(unturned(offset) - offset)).toBeLessThanOrEqual(180);
    }
  });

  it("always lands somewhere that shows the colors an uncarried room shows", () => {
    for (let offset = -720; offset <= 720; offset += 7) {
      expect(hueShifted(200, unturned(offset))).toBeCloseTo(200, 10);
    }
  });
});
