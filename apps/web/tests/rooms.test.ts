/**
 * How big each finisher's room is, and where its eye stands in it.
 *
 * The numbers themselves are a matter of taste and are not pinned here. What
 * is pinned is what they have to be true of: an eye outside the arrangement it
 * is looking at, lamps outside the subject they circle, walls behind
 * everything, and a floor that reaches past all of it. A room that fails one
 * of these is a room with the camera inside a face or a wall through a chin.
 */

import { describe, expect, it } from "vitest";
import {
  frontOf,
  reachOf,
  STANDING_IN,
} from "../src/features/catalog/artwork/arrangement.ts";
import {
  ELEVATION_BOUNDS,
  eyeAt,
} from "../src/features/catalog/artwork/orbit.ts";
import {
  distanceFor,
  EYE_DISTANCE,
  EYE_HEIGHT,
  EYE_RADIUS,
  FIELD_OF_VIEW,
  LAMP_RADIUS,
  OPEN_ROOM,
  REACH,
  ROOM_EXTENT,
  WALL_AT,
} from "../src/features/catalog/artwork/rooms.ts";

const LENSES = [FIELD_OF_VIEW.roughness, FIELD_OF_VIEW.emission, FIELD_OF_VIEW.coating];

describe("distanceFor", () => {
  it("stands back far enough to fit what it is framing", () => {
    // A sphere of radius `framed` fits the frame exactly when the half angle
    // of the lens reaches it, which is what this has to solve for.
    for (const lens of LENSES) {
      for (const framed of [0.5, 1, 2.5, 8]) {
        const half = Math.atan(framed / distanceFor(framed, lens));

        expect((half * 360) / Math.PI).toBeCloseTo(lens, 10);
      }
    }
  });

  it("stands twice as far back to frame twice as much", () => {
    for (const lens of LENSES) {
      expect(distanceFor(4, lens)).toBeCloseTo(2 * distanceFor(2, lens), 10);
    }
  });

  it("stands closer through a wider lens", () => {
    expect(distanceFor(1, FIELD_OF_VIEW.roughness)).toBeLessThan(
      distanceFor(1, FIELD_OF_VIEW.emission),
    );
  });

  it("has nowhere to stand back from nothing", () => {
    for (const lens of LENSES) expect(distanceFor(0, lens)).toBe(0);
  });
});

describe("REACH", () => {
  it("covers the arrangement each room actually stands", () => {
    expect(REACH.roughness).toBe(reachOf(STANDING_IN.roughness));
    expect(REACH.emission).toBe(reachOf(STANDING_IN.emission));
    expect(REACH.coating).toBe(reachOf(STANDING_IN.coating));
  });
});

describe("the eye", () => {
  it("stands outside the arrangement it is looking at, in every room", () => {
    expect(EYE_DISTANCE.roughness).toBeGreaterThan(REACH.roughness);
    expect(EYE_DISTANCE.emission).toBeGreaterThan(REACH.emission);
    expect(EYE_DISTANCE.coating).toBeGreaterThan(REACH.coating);
  });

  it("stands above the floor and looks down at what is lying on it", () => {
    expect(EYE_HEIGHT.roughness.stands).toBeGreaterThan(EYE_HEIGHT.roughness.looksAt);
    expect(EYE_HEIGHT.coating.stands).toBeGreaterThan(EYE_HEIGHT.coating.looksAt);
  });

  it("orbits a glowing room at the distance that room is framed from", () => {
    expect(EYE_RADIUS).toBe(EYE_DISTANCE.emission);
  });

  it("stands clear of the near subject of the coated room it is framing", () => {
    // Measured from that subject rather than from the middle of the floor,
    // because that subject is the thing the eye can end up inside of.
    const front = frontOf(STANDING_IN.coating);

    expect(EYE_DISTANCE.coating - front.toward).toBeGreaterThan(front.reach);
  });

  it("stands nearer a coated room than fitting its whole floor would ask for", () => {
    expect(EYE_DISTANCE.coating).toBeLessThan(
      distanceFor(REACH.coating, FIELD_OF_VIEW.coating),
    );
  });
});

describe("the lamps", () => {
  it("hang outside every arrangement a corner stands", () => {
    expect(LAMP_RADIUS).toBeGreaterThan(REACH.roughness);
    expect(LAMP_RADIUS).toBeGreaterThan(REACH.coating);
  });

  it("hang inside the walls at every elevation the pointer can reach", () => {
    // A lamp is above the floor, so the furthest from the middle it ever gets
    // is at the lowest the pointer can carry the ring.
    expect(LAMP_RADIUS * Math.cos(ELEVATION_BOUNDS.lowest)).toBeLessThan(WALL_AT);
  });
});

describe("the walls", () => {
  it("stand behind the arrangement of either corner", () => {
    expect(WALL_AT).toBeGreaterThan(REACH.roughness);
    expect(WALL_AT).toBeGreaterThan(REACH.coating);
  });

  it("stand behind the lamps too, so a lamp is never inside one", () => {
    expect(WALL_AT).toBeGreaterThan(LAMP_RADIUS);
  });

  it("run far enough that the eye cannot see past their edges", () => {
    // The floor runs `ROOM_EXTENT` times the wall distance and is centered on
    // the middle of the room, so it reaches half that in every direction.
    expect((WALL_AT * ROOM_EXTENT) / 2).toBeGreaterThan(EYE_DISTANCE.roughness);
    expect((WALL_AT * ROOM_EXTENT) / 2).toBeGreaterThan(EYE_DISTANCE.coating);
  });
});

describe("the open room", () => {
  it("lays floor well past the eye that walks around it", () => {
    expect(OPEN_ROOM.radius).toBeGreaterThan(EYE_RADIUS * 2);
  });

  it("closes above the top of the frame, wherever the eye is put", () => {
    // The top of the picture is the ray leaving the eye half a lens above its
    // own axis, and the axis is pitched down by however high the orbit is. A
    // wall shorter than where that ray meets the far side of the room is a
    // wall with the dark beyond it in the picture.
    const half = (FIELD_OF_VIEW.emission * Math.PI) / 360;
    const steps = 20;

    for (let step = 0; step <= steps; step += 1) {
      const elevation =
        ELEVATION_BOUNDS.lowest +
        (step / steps) * (ELEVATION_BOUNDS.highest - ELEVATION_BOUNDS.lowest);
      const eye = eyeAt({ azimuth: 0, elevation }, EYE_RADIUS);
      const stands = EYE_HEIGHT.emission.looksAt + eye.y;
      const away = OPEN_ROOM.radius + Math.hypot(eye.x, eye.z);

      expect(stands + away * Math.tan(half - elevation)).toBeLessThan(OPEN_ROOM.height);
    }
  });
});
