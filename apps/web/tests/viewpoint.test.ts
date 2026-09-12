/**
 * Where a scene is looked at from.
 *
 * What is pinned is what the numbers have to be true of: the eye at rest
 * stands and looks where it rests, a strayed eye keeps its subject where the
 * resting frame puts it and at the size the viewpoint asks for through
 * whatever lens, every product strays within its bounds and the same way
 * every time — and from every corner of those bounds every scene is still
 * closed, with each ray through the edge of the frame landing on the room
 * rather than going past where it ends.
 */

import { Option, STILL_ANGLES, type StillAngle } from "@prism/shared";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";
import { MESH_REACH } from "../src/features/catalog/artwork/arrangement.ts";
import { LAGS, restingAt } from "../src/features/catalog/artwork/lightring.ts";
import { type Eye, REST_ORBIT } from "../src/features/catalog/artwork/orbit.ts";
import {
  camera,
  type Camera,
  type Fog,
  fog,
  LAMP_RADIUS,
  OPEN_FOG,
  RING_AT_REST,
  type SceneInput,
  shell,
  type ShellForm,
  STANDING_IN,
  type View,
} from "../src/features/catalog/artwork/scenes.ts";
import { REST } from "../src/features/catalog/artwork/tilt.ts";
import {
  AT_REST,
  distanceAt,
  fieldOfViewAt,
  type Gaze,
  type Look,
  lookFrom,
  SWAY,
  type Viewpoint,
  viewpointOf,
} from "../src/features/catalog/artwork/viewpoint.ts";

const plus = (a: Eye, b: Eye): Eye => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const minus = (a: Eye, b: Eye): Eye => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scaled = (a: Eye, by: number): Eye => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const dot = (a: Eye, b: Eye): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Eye, b: Eye): Eye => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: Eye): number => Math.hypot(a.x, a.y, a.z);
const normalized = (a: Eye): Eye => scaled(a, 1 / length(a));
const distance = (from: Eye, to: Eye): number => length(minus(from, to));

const tanHalf = (fieldOfView: number): number => Math.tan((fieldOfView * Math.PI) / 360);
const radians = (inDegrees: number): number => (inDegrees * Math.PI) / 180;
const degrees = (inRadians: number): number => (inRadians * 180) / Math.PI;

/** The camera's own axes for a look, the way a camera pointed with `lookAt` holds them. */
const axesOf = (look: Look): Readonly<{ forward: Eye; right: Eye; up: Eye }> => {
  const forward = normalized(minus(look.target, look.eye));
  const right = normalized(cross(forward, { x: 0, y: 1, z: 0 }));

  return { forward, right, up: cross(right, forward) };
};

/** Where a point lies in a look's picture, as tangents right of and above its line of sight. */
const seenAt = (look: Look, point: Eye): Readonly<{ right: number; up: number }> => {
  const { forward, right, up } = axesOf(look);
  const toward = minus(point, look.eye);
  const depth = dot(toward, forward);

  return { right: dot(toward, right) / depth, up: dot(toward, up) / depth };
};

const LENS = 40;
const TARGET = { x: 0, y: 0.4, z: 0 };
const RESTING = { x: 1.2, y: 1.1, z: 2.5 };

/**
 * A gaze that walks around what it looks at, and one that walks around
 * something nearer: two fifths of the way over the floor from the target to
 * the eye, on the upright plane through both.
 */
const GAZES: readonly Gaze[] = [
  { eye: RESTING, target: TARGET, pivot: TARGET },
  { eye: RESTING, target: TARGET, pivot: { x: 0.48, y: 0.4, z: 1 } },
];

const turnedBy = (around: number, up: number): Viewpoint => ({ ...AT_REST, around, up });

const TURNS = [
  turnedBy(0.5, 0),
  turnedBy(-0.5, 0),
  turnedBy(0, 0.3),
  turnedBy(1.1, 0.2),
  turnedBy(-0.7, 0.4),
];

describe("lookFrom", () => {
  it("stands and looks where the eye rests, at rest", () => {
    for (const gaze of GAZES) {
      const look = lookFrom(gaze, AT_REST, LENS);
      const sight = normalized(minus(look.target, look.eye));
      const resting = normalized(minus(gaze.target, gaze.eye));

      expect(distance(look.eye, gaze.eye)).toBeCloseTo(0, 12);
      expect(distance(sight, resting)).toBeCloseTo(0, 12);
    }
  });

  it("keeps the eye as far from what it walks around as it rests, through the same lens", () => {
    for (const gaze of GAZES) {
      for (const viewpoint of TURNS) {
        expect(distance(lookFrom(gaze, viewpoint, LENS).eye, gaze.pivot)).toBeCloseTo(
          distance(gaze.eye, gaze.pivot),
          12,
        );
      }
    }
  });

  it("keeps what it walks around where the resting frame puts it", () => {
    for (const gaze of GAZES) {
      const resting = seenAt(lookFrom(gaze, AT_REST, LENS), gaze.pivot);

      for (const turn of TURNS) {
        for (const scale of [0.9, 1.1]) {
          const seen = seenAt(lookFrom(gaze, { ...turn, scale }, LENS), gaze.pivot);

          expect(seen.right).toBeCloseTo(resting.right, 10);
          expect(seen.up).toBeCloseTo(resting.up, 10);
        }
      }
    }
  });

  it("draws what it walks around `scale` times its resting size, through any lens", () => {
    // Size in the frame goes as one over the distance times the tangent of
    // half the lens, so the two products have to stand in the scale's ratio.
    for (const gaze of GAZES) {
      const resting = distance(gaze.eye, gaze.pivot) * tanHalf(LENS);

      for (const lens of [0.8, 1, 1.25]) {
        for (const scale of [0.9, 1, 1.1]) {
          const viewpoint = { ...AT_REST, lens, scale };
          const seen =
            distance(lookFrom(gaze, viewpoint, LENS).eye, gaze.pivot) *
            tanHalf(fieldOfViewAt(LENS, viewpoint));

          expect(resting / seen).toBeCloseTo(scale, 12);
        }
      }
    }
  });

  it("walks the eye to its own right for a positive turn", () => {
    // Standing on +z and looking back at the origin, the eye's right is +x.
    const origin = { x: 0, y: 0, z: 0 };
    const straight = { eye: { x: 0, y: 0, z: 4 }, target: origin, pivot: origin };

    expect(lookFrom(straight, turnedBy(0.3, 0), LENS).eye.x).toBeGreaterThan(0);
    expect(lookFrom(straight, turnedBy(-0.3, 0), LENS).eye.x).toBeLessThan(0);
  });

  it("raises the eye by the angle asked, without moving it around", () => {
    for (const gaze of GAZES) {
      const resting = minus(gaze.eye, gaze.pivot);
      const raised = minus(lookFrom(gaze, turnedBy(0, 0.3), LENS).eye, gaze.pivot);
      const elevation = (at: Eye): number => Math.atan2(at.y, Math.hypot(at.x, at.z));

      expect(elevation(raised) - elevation(resting)).toBeCloseTo(0.3, 12);
      expect(Math.atan2(raised.x, raised.z)).toBeCloseTo(Math.atan2(resting.x, resting.z), 12);
    }
  });
});

describe("distanceAt", () => {
  it("stands in for a wider lens and back for a longer one", () => {
    expect(distanceAt(LENS, { ...AT_REST, lens: 1.2 })).toBeLessThan(1);
    expect(distanceAt(LENS, { ...AT_REST, lens: 0.8 })).toBeGreaterThan(1);
  });

  it("stands where it rests at rest", () => {
    expect(distanceAt(LENS, AT_REST)).toBe(1);
  });
});

describe("fieldOfViewAt", () => {
  it("widens the lens a scene rests at by the viewpoint's", () => {
    expect(fieldOfViewAt(30, { ...AT_REST, lens: 1.2 })).toBeCloseTo(36, 12);
    expect(fieldOfViewAt(30, AT_REST)).toBe(30);
  });
});

/** Every angle but the one the live scene opens on. */
const STRAYING = STILL_ANGLES.filter((angle) => angle.aroundDegrees !== 0 || angle.upDegrees !== 0);

const SLUGS = Array.from({ length: 400 }, (_, index) => `product-${index}`);

describe("viewpointOf", () => {
  it("leaves the angle the live scene opens on at rest, for every product", () => {
    for (const slug of SLUGS) expect(viewpointOf(STILL_ANGLES[0], slug)).toEqual(AT_REST);
  });

  it("strays every other angle the same way every time", () => {
    for (const angle of STRAYING) {
      expect(viewpointOf(angle, "void-black")).toEqual(viewpointOf(angle, "void-black"));
    }
  });

  it("strays each product somewhere of its own", () => {
    for (const angle of STRAYING) {
      const arounds = new Set(SLUGS.map((slug) => viewpointOf(angle, slug).around));
      const lenses = new Set(SLUGS.map((slug) => viewpointOf(angle, slug).lens));

      expect(arounds.size).toBe(SLUGS.length);
      expect(lenses.size).toBe(SLUGS.length);
    }
  });

  it("strays a product's angles apart from each other", () => {
    const lenses = STRAYING.map((angle) => viewpointOf(angle, "void-black").lens);

    expect(new Set(lenses).size).toBe(lenses.length);
  });

  it("stays within its bounds, above the resting eye and on its own side", () => {
    for (const angle of STRAYING) {
      for (const slug of SLUGS) {
        const viewpoint = viewpointOf(angle, slug);
        const around = degrees(viewpoint.around);
        const up = degrees(viewpoint.up);

        expect(Math.abs(around - angle.aroundDegrees)).toBeLessThanOrEqual(SWAY.aroundDegrees);
        expect(Math.abs(up - angle.upDegrees)).toBeLessThanOrEqual(SWAY.upDegrees);
        expect(up).toBeGreaterThanOrEqual(0);
        expect(Math.sign(around) * Math.sign(angle.aroundDegrees)).toBeGreaterThanOrEqual(0);
        expect(viewpoint.lens).toBeGreaterThanOrEqual(SWAY.lens.least);
        expect(viewpoint.lens).toBeLessThanOrEqual(SWAY.lens.most);
        expect(viewpoint.scale).toBeGreaterThanOrEqual(SWAY.scale.least);
        expect(viewpoint.scale).toBeLessThanOrEqual(SWAY.scale.most);
      }
    }
  });

  it("keeps a side angle on its side however far it strays", () => {
    for (const angle of STRAYING) {
      if (angle.aroundDegrees !== 0) {
        expect(Math.abs(angle.aroundDegrees)).toBeGreaterThan(SWAY.aroundDegrees);
      }
    }
  });
});

/* ----------------------------------------------- what every still can see */

/** The least, the middle and the most of a range. */
const across = (least: number, most: number): readonly number[] => [
  least,
  (least + most) / 2,
  most,
];

/** Every corner and middle of the box an angle's viewpoints are drawn from. */
const extremesOf = (angle: StillAngle): readonly Viewpoint[] =>
  across(angle.aroundDegrees - SWAY.aroundDegrees, angle.aroundDegrees + SWAY.aroundDegrees).flatMap(
    (around) =>
      across(Math.max(0, angle.upDegrees - SWAY.upDegrees), angle.upDegrees + SWAY.upDegrees).flatMap(
        (up) =>
          across(SWAY.lens.least, SWAY.lens.most).flatMap((lens) =>
            across(SWAY.scale.least, SWAY.scale.most).map((scale) => ({
              around: radians(around),
              up: radians(up),
              lens,
              scale,
            })),
          ),
      ),
  );

/** Every viewpoint a still of any product can be taken from, at the edges of what it may be. */
const STILL_VIEWPOINTS: readonly Readonly<{ angle: string; viewpoint: Viewpoint }>[] = [
  { angle: STILL_ANGLES[0].name, viewpoint: AT_REST },
  ...STRAYING.flatMap((angle) =>
    extremesOf(angle).map((viewpoint) => ({ angle: angle.name, viewpoint })),
  ),
];

/** Rays sampled along each side of the frame. */
const EDGE_STEPS = 40;

/** The direction of every sampled ray through the edge of a look's square frame. */
const edgeRays = (look: Look, fieldOfView: number): readonly Eye[] => {
  const { forward, right, up } = axesOf(look);
  const reach = tanHalf(fieldOfView);
  const along = Array.from({ length: EDGE_STEPS + 1 }, (_, step) => -1 + (2 * step) / EDGE_STEPS);
  const edge = along.flatMap((at) => [
    [at, -1],
    [at, 1],
    [-1, at],
    [1, at],
  ]);

  return edge.map(([aside = 0, down = 0]) =>
    normalized(plus(forward, plus(scaled(right, aside * reach), scaled(up, down * reach)))),
  );
};

/** One flat surface: a plane where one axis is `at`, bounded along the other two. */
type Panel = Readonly<{
  axis: "x" | "y" | "z";
  at: number;
  bounds: readonly (readonly ["x" | "y" | "z", number, number])[];
}>;

/** Whether a ray from `eye` along `ray` meets `panel` in front of the eye. */
const meets = (eye: Eye, ray: Eye, panel: Panel): boolean => {
  const along = (panel.at - eye[panel.axis]) / ray[panel.axis];
  const hit = plus(eye, scaled(ray, along));

  return (
    along > 0 && panel.bounds.every(([axis, least, most]) => hit[axis] >= least && hit[axis] <= most)
  );
};

const panel = (axis: Panel["axis"], at: number, bounds: Panel["bounds"]): Panel => ({
  axis,
  at,
  bounds,
});

/** The flat surfaces of a shell, for the shells made of flat surfaces. */
const panelsOf = (form: ShellForm): readonly Panel[] =>
  match(form)
    .with({ _tag: "Backdrop" }, ({ size, distance }) => [
      panel("z", -distance, [
        ["x", -size / 2, size / 2],
        ["y", -size / 2, size / 2],
      ]),
    ])
    .with({ _tag: "Corner" }, ({ wallAt, extent }) => {
      // The floor and walls run `extent` across, centered on the middle of
      // the room, so they reach half that in every direction.
      const reach = extent / 2;

      return [
        panel("y", 0, [
          ["x", -reach, reach],
          ["z", -reach, reach],
        ]),
        panel("z", -wallAt, [
          ["x", -reach, reach],
          ["y", 0, extent],
        ]),
        panel("x", -wallAt, [
          ["z", -reach, reach],
          ["y", 0, extent],
        ]),
      ];
    })
    .with({ _tag: "Drum" }, () => [])
    .exhaustive();

/** A round floor with one wall all the way around it. */
type Drum = Readonly<{ radius: number; height: number }>;

/** Where a ray from inside a drum meets it: on its floor, or on the circle its wall stands on. */
type DrumHit = Readonly<{ on: "floor" | "wall"; along: number; height: number }>;

const inDrum = (drum: Drum, eye: Eye, ray: Eye): DrumHit => {
  const floor = -eye.y / ray.y;
  const onFloor = plus(eye, scaled(ray, floor));

  if (floor > 0 && Math.hypot(onFloor.x, onFloor.z) <= drum.radius) {
    return { on: "floor", along: floor, height: 0 };
  }

  // The far root of the ray against the wall's circle: the eye is inside it.
  const a = ray.x ** 2 + ray.z ** 2;
  const b = 2 * (eye.x * ray.x + eye.z * ray.z);
  const c = eye.x ** 2 + eye.z ** 2 - drum.radius ** 2;
  const wall = (-b + Math.sqrt(b ** 2 - 4 * a * c)) / (2 * a);

  return { on: "wall", along: wall, height: eye.y + wall * ray.y };
};

/** Whether a ray from inside a shell lands on it rather than going past where it ends. */
const landsIn =
  (form: ShellForm) =>
  (eye: Eye, ray: Eye): boolean =>
    match(form)
      .with({ _tag: "Drum" }, (drum) => {
        const hit = inDrum(drum, eye, ray);

        return hit.on === "floor" || (hit.height >= 0 && hit.height <= drum.height);
      })
      .otherwise((walled) => panelsOf(walled).some((flat) => meets(eye, ray, flat)));

const glowingFrom = (viewpoint: Viewpoint): View => ({
  _tag: "Emission",
  emission: 50,
  orbit: REST_ORBIT,
  viewpoint,
});

const coatedFrom = (viewpoint: Viewpoint): View => ({
  _tag: "Coating",
  coatingNanometers: 300,
  hueOffset: 0,
  viewpoint,
});

/** Every scene a still is taken of, seen from a viewpoint. */
const SCENES: readonly Readonly<{ name: string; viewFrom: (viewpoint: Viewpoint) => View }>[] =
  [
    {
      name: "a color's slab",
      viewFrom: (viewpoint) => ({
        _tag: "Color",
        hex: "#808080",
        finishing: { roughness: 50, coatingNanometers: 0, emission: 0 },
        tilt: REST,
        viewpoint,
      }),
    },
    {
      name: "a roughness corner",
      viewFrom: (viewpoint) => ({
        _tag: "Roughness",
        roughness: 50,
        lamps: restingAt(LAGS, RING_AT_REST, LAMP_RADIUS),
        viewpoint,
      }),
    },
    { name: "a coating corner", viewFrom: coatedFrom },
    { name: "a glowing room", viewFrom: glowingFrom },
  ];

/** A scene's input from a viewpoint; the theme moves neither its eye nor its shell. */
const seenFrom = (viewFrom: (viewpoint: Viewpoint) => View, viewpoint: Viewpoint): SceneInput => ({
  theme: "light",
  view: viewFrom(viewpoint),
});

/** The eye of a scene, and the lens it sees through, as a look. */
const lookOf = (eye: Camera): Look => ({ eye: eye.eye, target: eye.target });

describe("every scene a still is taken of", () => {
  for (const scene of SCENES) {
    it(`stays closed around ${scene.name}, from every viewpoint a still can stray to`, () => {
      const open = STILL_VIEWPOINTS.flatMap(({ angle, viewpoint }) => {
        const input = seenFrom(scene.viewFrom, viewpoint);
        const eye = camera(input);
        const lands = landsIn(shell(input).form);
        const rays = edgeRays(lookOf(eye), eye.fieldOfView);
        const escaping = rays.filter((ray) => !lands(eye.eye, ray)).length;

        return escaping === 0
          ? []
          : [`${angle} ${JSON.stringify(viewpoint)}: ${escaping} of ${rays.length}`];
      });

      expect(open).toEqual([]);
    });
  }

  it("keeps the whole of a coated room's near subject in the picture", () => {
    // The ball that would hold the whole mesh, which the head lying inside it
    // is a good deal smaller than. Its edge in the picture is its middle's
    // tangent off the line of sight plus the tangent of the angle it spans.
    const near = STANDING_IN.Coating.reduce((front, at) =>
      at.x + at.z > front.x + front.z ? at : front,
    );
    const reach = MESH_REACH * near.scale;
    // The height the room looks at, which is the middle of this subject.
    const middle = { x: near.x, y: camera(seenFrom(coatedFrom, AT_REST)).target.y, z: near.z };

    const cut = STILL_VIEWPOINTS.flatMap(({ angle, viewpoint }) => {
      const eye = camera(seenFrom(coatedFrom, viewpoint));
      const seen = seenAt(lookOf(eye), middle);
      const away = distance(eye.eye, middle);
      const spans = reach / Math.sqrt(away ** 2 - reach ** 2);
      const edge =
        (Math.max(Math.abs(seen.right), Math.abs(seen.up)) + spans) / tanHalf(eye.fieldOfView);

      return edge <= 1 ? [] : [`${angle} ${JSON.stringify(viewpoint)}: ${edge.toFixed(3)}`];
    });

    expect(cut).toEqual([]);
  });

  it("hides the open room's wall in its haze, from every viewpoint a still can stray to", () => {
    // Every ray through the frame, not only its edge: the nearest the wall
    // comes can be anywhere across the picture. A haze is laid by depth along
    // the line of sight, so that is what each hit is measured in.
    const steps = 40;
    const grid = Array.from({ length: steps + 1 }, (_, step) => -1 + (2 * step) / steps);

    const seen = STILL_VIEWPOINTS.flatMap(({ angle, viewpoint }) => {
      const input = seenFrom(glowingFrom, viewpoint);
      const eye = camera(input);
      const drum = match(shell(input).form)
        .with({ _tag: "Drum" }, (form): Drum => form)
        .otherwise(() => {
          throw new Error("not a drum");
        });
      const { forward, right, up } = axesOf(lookOf(eye));
      const reach = tanHalf(eye.fieldOfView);
      const closed = Option.match<Fog, number>({
        onSome: (haze) => haze.far,
        onNone: () => {
          throw new Error("no haze");
        },
      })(fog(input));
      const showing = grid
        .flatMap((aside) =>
          grid.map((down) =>
            normalized(plus(forward, plus(scaled(right, aside * reach), scaled(up, down * reach)))),
          ),
        )
        .filter((ray) => {
          const hit = inDrum(drum, eye.eye, ray);

          return hit.on === "wall" && hit.along * dot(ray, forward) < closed;
        }).length;

      return showing === 0 ? [] : [`${angle} ${JSON.stringify(viewpoint)}: ${showing}`];
    });

    expect(seen).toEqual([]);
  });

  it("leaves the open room's haze where it rests, at rest", () => {
    expect(fog(seenFrom(glowingFrom, AT_REST))).toEqual(Option.some(OPEN_FOG));
  });

  it("takes the haze back with an eye that stands back, both ends of it alike", () => {
    // A haze is measured from the eye, so an eye that stands back takes both
    // ends of it back with it by as far as it stepped.
    const stepped = Option.match<Fog, Fog>({
      onSome: (haze) => haze,
      onNone: () => {
        throw new Error("no haze");
      },
    })(fog(seenFrom(glowingFrom, { ...AT_REST, lens: 0.8 })));

    expect(stepped.near).toBeGreaterThan(OPEN_FOG.near);
    expect(stepped.far - OPEN_FOG.far).toBeCloseTo(stepped.near - OPEN_FOG.near, 12);
  });
});
