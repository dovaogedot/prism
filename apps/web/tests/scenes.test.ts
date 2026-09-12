/**
 * Every scene the shop draws, as data.
 *
 * The numbers themselves are a matter of taste and are not pinned here. What
 * is pinned is what they have to be true of: that two finishers in one room
 * differ by their finish and by nothing else, that a finisher's subject wears
 * the material a color at that amount wears, that nothing steps between two
 * neighboring amounts, that the eye stands outside what it looks at, that the
 * lamps hang inside the room and the walls stand behind everything, and that
 * the two corners are one room.
 */

import {
  COATING_BOUNDS,
  COATING_ROUGHNESS_CEILING,
  EMISSION_BOUNDS,
  Option,
  ROUGHNESS_BOUNDS,
  type Rgb,
} from "@prism/shared";
import { Color, SRGBColorSpace } from "three";
import { match, P } from "ts-pattern";
import { describe, expect, it } from "vitest";
import {
  frontOf,
  MESH_REACH,
  type Placement,
  reachOf,
  towardOf,
} from "../src/features/catalog/artwork/arrangement.ts";
import { LAGS, restingAt } from "../src/features/catalog/artwork/lightring.ts";
import {
  ELEVATION_BOUNDS,
  type Eye,
  eyeAt,
  REST_ORBIT,
} from "../src/features/catalog/artwork/orbit.ts";
import {
  air,
  bloom,
  camera,
  COATED_HUES,
  type CoatingView,
  type ColorView,
  type DirectionalShadow,
  distanceFor,
  type EmissionView,
  EYE_DISTANCE,
  EYE_HEIGHT,
  EYE_RADIUS,
  FIELD_OF_VIEW,
  type Fog,
  fog,
  GLOWING_HUES,
  LAMP_RADIUS,
  type Light,
  lights,
  type Material,
  OPEN_ROOM,
  REACH,
  RING_AT_REST,
  ROOM_EXTENT,
  type RoomType,
  type RoughnessView,
  scene,
  type Scene,
  type SceneInput,
  type Shadowing,
  type Shape,
  shell,
  type ShellForm,
  type SpotShadow,
  STANDING_IN,
  type Subject,
  subjects,
  type View,
  WALL_AT,
} from "../src/features/catalog/artwork/scenes.ts";
import {
  excite,
  type Finishing,
  surfaceFor,
} from "../src/features/catalog/artwork/surfaces.ts";
import { REST } from "../src/features/catalog/artwork/tilt.ts";
import { AT_REST } from "../src/features/catalog/artwork/viewpoint.ts";
import type { Theme } from "../src/shared/theme/use-theme.ts";

const THEMES: readonly Theme[] = ["light", "dark"];

const rough = (roughness: number): RoughnessView => ({
  _tag: "Roughness",
  roughness,
  lamps: restingAt(LAGS, RING_AT_REST, LAMP_RADIUS),
  viewpoint: AT_REST,
});

const glow = (emission: number): EmissionView => ({
  _tag: "Emission",
  emission,
  orbit: REST_ORBIT,
  viewpoint: AT_REST,
});

const coat = (coatingNanometers: number, hueOffset = 0): CoatingView => ({
  _tag: "Coating",
  coatingNanometers,
  hueOffset,
  viewpoint: AT_REST,
});

const color = (hex: string, finishing: Finishing): ColorView => ({
  _tag: "Color",
  hex,
  finishing,
  tilt: REST,
  viewpoint: AT_REST,
});

const PLAIN: Finishing = { roughness: 30, coatingNanometers: 0, emission: 0 };

/** One of each room, at an amount in the middle of its range. */
const ROOMS: Readonly<Record<RoomType, View>> = {
  Roughness: rough(50),
  Emission: glow(50),
  Coating: coat(300),
};

/** One of each kind of picture. */
const KINDS: readonly View[] = [color("#4a90d9", PLAIN), ...Object.values(ROOMS)];

const at = (theme: Theme, view: View): SceneInput => ({ theme, view });

/* --------------------------------------------------- every number in a scene */

const ofEye = (eye: Eye): readonly number[] => [eye.x, eye.y, eye.z];
const ofRgb = (rgb: Rgb): readonly number[] => [rgb.red, rgb.green, rgb.blue];

const ofShadowing = (shadow: Shadowing): readonly number[] => [
  shadow.mapSize,
  shadow.softness,
  shadow.blurSamples,
  shadow.normalBias,
  shadow.intensity,
];

const ofOption =
  <A>(numbers: (value: A) => readonly number[]) =>
  (option: Option<A>): readonly number[] =>
    Option.getOrElse<readonly number[]>(() => [])(Option.map(numbers)(option));

const ofLight = (light: Light): readonly number[] =>
  match(light)
    .with({ _tag: "Directional" }, ({ color: paint, intensity, at: hangs, shadow }) => [
      ...ofRgb(paint),
      intensity,
      ...ofEye(hangs),
      ...ofOption((casting: DirectionalShadow) => [
        ...ofShadowing(casting),
        casting.reach,
        casting.far,
      ])(shadow),
    ])
    .with(
      { _tag: "Spot" },
      ({ color: paint, intensity, at: hangs, aimedAt, angle, penumbra, shadow }) => [
        ...ofRgb(paint),
        intensity,
        ...ofEye(hangs),
        ...ofEye(aimedAt),
        angle,
        penumbra,
        ...ofOption((casting: SpotShadow) => [
          ...ofShadowing(casting),
          casting.near,
          casting.far,
        ])(shadow),
      ],
    )
    .with({ _tag: "Point" }, ({ color: paint, intensity, at: hangs }) => [
      ...ofRgb(paint),
      intensity,
      ...ofEye(hangs),
    ])
    .with(
      { _tag: "RectArea" },
      ({ color: paint, intensity, at: hangs, aimedAt, width, height, lean }) => [
        ...ofRgb(paint),
        intensity,
        ...ofEye(hangs),
        ...ofEye(aimedAt),
        width,
        height,
        lean,
      ],
    )
    .with({ _tag: "Hemisphere" }, ({ sky, ground, intensity }) => [
      ...ofRgb(sky),
      ...ofRgb(ground),
      intensity,
    ])
    .exhaustive();

const ofMaterial = (material: Material): readonly number[] => [
  ...ofRgb(material.color),
  ...ofRgb(material.emissive),
  material.emissiveIntensity,
  material.roughness,
  material.metalness,
  material.sheen,
  material.clearcoat,
  material.clearcoatRoughness,
  material.iridescence,
  material.coatingNanometers,
  material.envIntensity,
  material.relief,
];

const ofShape = (shape: Shape): readonly number[] =>
  match(shape)
    .with({ _tag: "Head" }, () => [])
    .with({ _tag: "Slab" }, ({ corner, depth, bevel }) => [corner, depth, bevel])
    .exhaustive();

const ofSubject = (subject: Subject): readonly number[] => [
  ...ofShape(subject.shape),
  ...ofEye(subject.transform.position),
  ...ofEye(subject.transform.rotation),
  subject.transform.scale,
  ...ofMaterial(subject.material),
];

const ofForm = (form: ShellForm): readonly number[] =>
  match(form)
    .with({ _tag: "Corner" }, ({ wallAt, extent, walls, floor }) => [
      wallAt,
      extent,
      ...ofRgb(walls),
      ...ofRgb(floor),
    ])
    .with({ _tag: "Drum" }, ({ radius, height, walls, floor }) => [
      radius,
      height,
      ...ofRgb(walls),
      ...ofRgb(floor),
    ])
    .with({ _tag: "Backdrop" }, ({ size, distance, wall }) => [size, distance, ...ofRgb(wall)])
    .exhaustive();

/**
 * Every number one picture is made of, in the order the picture holds them.
 *
 * Every field is named rather than walked, so a field added to a scene
 * without being added here stops being covered visibly rather than quietly.
 */
const numbersIn = (described: Scene): readonly number[] => [
  ...ofForm(described.shell.form),
  described.shell.roughness,
  described.shell.environment,
  ...described.subjects.flatMap(ofSubject),
  ...described.lights.flatMap(ofLight),
  ...ofEye(described.camera.eye),
  ...ofEye(described.camera.target),
  described.camera.fieldOfView,
  described.camera.near,
  described.camera.far,
  ...ofOption((haze: Fog) => [haze.near, haze.far])(described.fog),
  described.bloom.strength,
  described.bloom.threshold,
  described.air.environment,
  ...ofRgb(described.air.clear.paint),
  described.air.clear.level,
];

/** Where a lamp hangs, for every kind of lamp that hangs somewhere. */
const hangingOf = (light: Light): Option<Eye> =>
  match(light)
    .with({ _tag: P.union("Directional", "Spot", "Point", "RectArea") }, ({ at: hangs }) =>
      Option.some(hangs),
    )
    .with({ _tag: "Hemisphere" }, () => Option.none)
    .exhaustive();

/** Where a subject stands and how big it is, without its paint. */
const standingOf = ({ transform }: Subject) => transform;

const paintOf = ({ material }: Subject): Rgb => material.color;

/** The hue of a paint, in degrees, the way three reads it. */
const hueOf = (rgb: Rgb): number =>
  new Color()
    .setRGB(rgb.red / 255, rgb.green / 255, rgb.blue / 255, SRGBColorSpace)
    .getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).h * 360;

/* ------------------------------------------------------------- the scene */

describe("scene", () => {
  it("is made of the parts, each of them read off the same input", () => {
    for (const theme of THEMES) {
      for (const view of KINDS) {
        const input = at(theme, view);

        expect(scene(input)).toEqual({
          shell: shell(input),
          subjects: subjects(input),
          lights: lights(input),
          camera: camera(input),
          fog: fog(input),
          bloom: bloom(input),
          air: air(input),
        });
      }
    }
  });

  it("carries a finite number everywhere, in every picture under every theme", () => {
    for (const theme of THEMES) {
      for (const view of KINDS) {
        for (const number of numbersIn(scene(at(theme, view)))) {
          expect(Number.isFinite(number)).toBe(true);
        }
      }
    }
  });
});

/* ------------------------------------------------------- the same room */

/** Every neighboring pair of amounts in a range, one apart. */
const neighbors = (
  bounds: Readonly<{ min: number; max: number }>,
  build: (amount: number) => View,
): readonly (readonly [View, View])[] =>
  Array.from(
    { length: bounds.max - bounds.min },
    (_, step) => [build(bounds.min + step), build(bounds.min + step + 1)] as const,
  );

/**
 * The largest step any number of the scene takes between two neighboring
 * finishers, as a share of `span`.
 */
const biggestStep = (
  theme: Theme,
  pairs: readonly (readonly [View, View])[],
  span: number,
): number =>
  pairs.reduce((worst, [before, after]) => {
    const was = numbersIn(scene(at(theme, before)));
    const is = numbersIn(scene(at(theme, after)));

    expect(is.length).toBe(was.length);

    return was.reduce(
      (most, number, index) =>
        Math.max(most, Math.abs((is[index] ?? Number.NaN) - number) / span),
      worst,
    );
  }, 0);

describe("two finishers in the same room", () => {
  const AMOUNTS: readonly Readonly<{ room: RoomType; views: readonly View[] }>[] = [
    { room: "Roughness", views: [5, 47, 95].map(rough) },
    { room: "Emission", views: [0, 62, 100].map(glow) },
    { room: "Coating", views: [100, 350, 600].map((coatingNanometers) => coat(coatingNanometers)) },
  ];

  it("stand the same shapes in the same places at the same sizes wearing the same paint", () => {
    for (const theme of THEMES) {
      for (const { views } of AMOUNTS) {
        const [first, ...rest] = views.map((view) => scene(at(theme, view)));

        if (first === undefined) throw new Error("short");

        for (const other of rest) {
          expect(other.subjects.map(standingOf)).toEqual(first.subjects.map(standingOf));
          expect(other.subjects.map(paintOf)).toEqual(first.subjects.map(paintOf));
          expect(other.lights.map(hangingOf)).toEqual(first.lights.map(hangingOf));
          expect(other.shell).toEqual(first.shell);
          expect(other.camera).toEqual(first.camera);
        }
      }
    }
  });

  it("have no step between them anywhere, on any of the three", () => {
    // A point of roughness or of glow is about 1% of its range and a
    // nanometer is 0.2% of its own, so nothing may move more than a few
    // percent of its own scale between two neighboring finishers.
    for (const theme of THEMES) {
      expect(biggestStep(theme, neighbors(ROUGHNESS_BOUNDS, rough), 1)).toBeLessThan(0.05);
      expect(biggestStep(theme, neighbors(EMISSION_BOUNDS, glow), 1)).toBeLessThan(0.05);
      expect(
        biggestStep(theme, neighbors(COATING_BOUNDS, coat), COATING_BOUNDS.max),
      ).toBeLessThan(0.05);
    }
  });
});

describe("the two corners", () => {
  it("are one room, with different things standing in it", () => {
    for (const theme of THEMES) {
      const plain = scene(at(theme, rough(50)));
      const coated = scene(at(theme, coat(300)));

      expect(coated.shell).toEqual(plain.shell);
      expect(coated.lights.map(hangingOf)).toEqual(plain.lights.map(hangingOf));
      expect(coated.lights.map((light) => light._tag)).toEqual(
        plain.lights.map((light) => light._tag),
      );
      expect(coated.air.clear.paint).toEqual(plain.air.clear.paint);
    }
  });

  it("light a coating harder than a plain surface at night", () => {
    // Interference is a reflection, and a reflection needs a room to be of.
    const plain = lights(at("dark", rough(50)));
    const coated = lights(at("dark", coat(300)));

    for (const [before, after] of plain.map((light, index) => [light, coated[index]] as const)) {
      if (after === undefined) throw new Error("short");

      expect(after.intensity).toBeGreaterThan(before.intensity);
    }
  });
});

/* ---------------------------------------------------------- the subjects */

describe("a roughness room's subject", () => {
  it("wears the material a color at that roughness wears", () => {
    for (const roughness of [5, 20, 47, 80, 95]) {
      const expected = surfaceFor({ roughness, coatingNanometers: 0, emission: 0 });

      for (const theme of THEMES) {
        for (const { material } of subjects(at(theme, rough(roughness)))) {
          expect(material).toMatchObject({
            roughness: expected.roughness,
            metalness: expected.metalness,
            sheen: expected.sheen,
            clearcoat: expected.clearcoat,
            clearcoatRoughness: expected.clearcoatRoughness,
            iridescence: expected.iridescence,
            coatingNanometers: expected.coatingNanometers,
            envIntensity: expected.envIntensity,
            relief: expected.relief,
            emissiveIntensity: 0,
          });
        }
      }
    }
  });

  it("is the one neutral, whatever the amount and whatever the theme", () => {
    const paints = new Set(
      THEMES.flatMap((theme) =>
        [5, 50, 95].flatMap((roughness) =>
          subjects(at(theme, rough(roughness))).map((subject) =>
            JSON.stringify(paintOf(subject)),
          ),
        ),
      ),
    );

    expect(paints.size).toBe(1);
  });
});

describe("a coated room's subjects", () => {
  it("carry the coating's thickness through untouched, fully on and with nothing over it", () => {
    for (const coatingNanometers of [100, 237, 600]) {
      for (const { material } of subjects(at("light", coat(coatingNanometers)))) {
        expect(material.coatingNanometers).toBe(coatingNanometers);
        expect(material.iridescence).toBe(1);
        // A coating is the top layer; a lacquer over it would be glare.
        expect(material.clearcoat).toBe(0);
      }
    }
  });

  it("stand a coating on a surface smooth enough to show one", () => {
    // Interference happens to a reflection, so the shop will not sell a coated
    // color rougher than the ceiling. A room demonstrating a coating is held
    // to the same rule, or it demonstrates something nothing in the shop is.
    const roughest = surfaceFor({
      roughness: COATING_ROUGHNESS_CEILING,
      coatingNanometers: 300,
      emission: 0,
    });

    for (const { material } of subjects(at("light", coat(300)))) {
      expect(material.roughness).toBeLessThan(roughest.roughness);
      // And nothing on it competes with the coating: a sheen starts well
      // above anything a coating is sold on.
      expect(material.sheen).toBe(0);
    }
  });

  it("wear their own hues, carried around the wheel together by the offset", () => {
    for (const hueOffset of [0, 90, 250]) {
      const painted = subjects(at("dark", coat(300, hueOffset))).map((subject) =>
        hueOf(paintOf(subject)),
      );

      // To three places: a paint is mixed in sRGB and read back through
      // linear light, which is a round trip through two curves.
      expect(painted).toEqual(
        COATED_HUES.slice(0, painted.length).map((hue) =>
          expect.closeTo((hue + hueOffset) % 360, 3),
        ),
      );
    }
  });
});

describe("a glowing room's subjects", () => {
  it("wear their own hues, one pigment at three places on the wheel", () => {
    const painted = subjects(at("dark", glow(50))).map((subject) =>
      new Color()
        .setRGB(
          paintOf(subject).red / 255,
          paintOf(subject).green / 255,
          paintOf(subject).blue / 255,
          SRGBColorSpace,
        )
        .getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace),
    );

    expect(painted.map(({ h }) => h * 360)).toEqual(
      GLOWING_HUES.slice(0, painted.length).map((hue) => expect.closeTo(hue, 3)),
    );
    expect(new Set(painted.map(({ s }) => s.toFixed(6))).size).toBe(1);
    expect(new Set(painted.map(({ l }) => l.toFixed(6))).size).toBe(1);
  });

  it("give off their own hue at full strength, and more of it the harder they glow", () => {
    for (const theme of THEMES) {
      const still = subjects(at(theme, glow(0)));
      const faint = subjects(at(theme, glow(35)));
      const full = subjects(at(theme, glow(100)));

      for (const [subject, index] of full.map((subject, index) => [subject, index] as const)) {
        expect(subject.material.emissive).toEqual(excite(subject.material.color));
        expect(still[index]?.material.emissiveIntensity).toBe(0);
        expect(faint[index]?.material.emissiveIntensity).toBeGreaterThan(0);
        expect(subject.material.emissiveIntensity).toBeGreaterThan(
          faint[index]?.material.emissiveIntensity ?? Number.NaN,
        );
      }
    }
  });

  it("carry the glow a color at that emission carries", () => {
    for (const emission of [0, 35, 62, 100]) {
      const expected = surfaceFor({ roughness: 60, coatingNanometers: 0, emission });

      for (const { material } of subjects(at("light", glow(emission)))) {
        expect(material.roughness).toBe(expected.roughness);
        expect(material.envIntensity).toBe(expected.envIntensity);
      }
    }
  });

  it("each light the floor under themselves with their own band", () => {
    for (const theme of THEMES) {
      const standing = subjects(at(theme, glow(70)));
      const pools = lights(at(theme, glow(70))).flatMap((light) =>
        match(light)
          .with({ _tag: "Spot" }, (pool) => [pool])
          .otherwise(() => []),
      );

      expect(pools.length).toBe(standing.length);

      for (const [pool, index] of pools.map((pool, index) => [pool, index] as const)) {
        const subject = standing[index];

        if (subject === undefined) throw new Error("short");

        const { position } = subject.transform;

        expect(pool.at).toEqual(position);
        expect(pool.aimedAt).toEqual({ x: position.x, y: 0, z: position.z });
        expect(pool.color).toEqual(subject.material.emissive);
        expect(pool.intensity).toBeGreaterThan(0);
      }
    }
  });
});

describe("a color's slab", () => {
  it("wears the color it is sold as", () => {
    const [slab] = subjects(at("light", color("#ff8000", PLAIN)));

    expect(slab?.material.color).toEqual({ red: 255, green: 128, blue: 0 });
    expect(slab?.material.emissiveIntensity).toBe(0);
  });

  it("wears the wall's own paint for a hex nobody can parse", () => {
    for (const theme of THEMES) {
      const input = at(theme, color("nope", PLAIN));
      const [slab] = subjects(input);

      expect(slab?.material.color).toEqual(
        match(shell(input).form)
          .with({ _tag: "Backdrop" }, ({ wall }) => wall)
          .otherwise(() => undefined),
      );
    }
  });

  it("both reflects and gives off its band when it glows", () => {
    const [slab] = subjects(
      at("light", color("#804000", { roughness: 30, coatingNanometers: 0, emission: 60 })),
    );
    const band = excite({ red: 128, green: 64, blue: 0 });

    expect(slab?.material.color).toEqual(band);
    expect(slab?.material.emissive).toEqual(band);
    expect(slab?.material.emissiveIntensity).toBeGreaterThan(0);
  });

  it("stands at the angle it was tilted to", () => {
    const [slab] = subjects(
      at("light", { ...color("#ff8000", PLAIN), tilt: { x: 0.2, y: -0.3 } }),
    );

    expect(slab?.transform.rotation).toEqual({ x: 0.2, y: -0.3, z: 0 });
  });
});

/* -------------------------------------------------------------- the light */

describe("the glowing room's lamps", () => {
  it("dim as the glow gets stronger, and never go out", () => {
    for (const theme of THEMES) {
      const faint = lights(at(theme, glow(EMISSION_BOUNDS.min)));
      const full = lights(at(theme, glow(EMISSION_BOUNDS.max)));
      const keys = (lit: readonly Light[]): readonly number[] =>
        lit.flatMap((light) =>
          match(light)
            .with({ _tag: "Directional" }, ({ intensity }) => [intensity])
            .otherwise(() => []),
        );

      const dimmed = keys(full);

      expect(dimmed.length).toBeGreaterThan(0);

      for (const [before, after] of keys(faint).map((key, index) => [key, dimmed[index]] as const)) {
        if (after === undefined) throw new Error("short");

        expect(after).toBeLessThan(before);
        expect(after).toBeGreaterThan(0);
      }
    }
  });
});

describe("the spill", () => {
  it("is nothing in a room whose lamps move", () => {
    for (const theme of THEMES) {
      for (const roughness of [5, 40, 95]) {
        expect(bloom(at(theme, rough(roughness))).strength).toBe(0);
      }
    }
  });

  it("is nothing in a coated room, where no light is added", () => {
    for (const theme of THEMES) {
      for (const coatingNanometers of [100, 300, 600]) {
        expect(bloom(at(theme, coat(coatingNanometers))).strength).toBe(0);
      }
    }
  });

  it("comes off a glow, and harder the harder it glows", () => {
    for (const theme of THEMES) {
      const faint = bloom(at(theme, glow(35)));
      const full = bloom(at(theme, glow(100)));

      expect(full.strength).toBeGreaterThan(faint.strength);
      expect(full.threshold).toBeLessThan(faint.threshold);
    }
  });

  it("never spills a color further than its own finish asks for", () => {
    for (const theme of THEMES) {
      for (const finishing of [PLAIN, { roughness: 5, coatingNanometers: 0, emission: 80 }]) {
        const asked = surfaceFor(finishing).bloom;
        const drawn = bloom(at(theme, color("#20a0ff", finishing)));

        expect(drawn.strength).toBeLessThanOrEqual(asked.strength);
        expect(drawn.threshold).toBe(asked.threshold);
      }
    }
  });
});

describe("the air", () => {
  it("clears every picture to the paint of the wall behind it", () => {
    for (const theme of THEMES) {
      for (const view of KINDS) {
        const input = at(theme, view);

        expect(air(input).clear.paint).toEqual(
          match(shell(input).form)
            .with({ _tag: P.union("Corner", "Drum") }, ({ walls }) => walls)
            .with({ _tag: "Backdrop" }, ({ wall }) => wall)
            .exhaustive(),
        );
      }
    }
  });

  it("hazes the open room and no other", () => {
    for (const theme of THEMES) {
      for (const view of KINDS) {
        expect(Option.isSome(fog(at(theme, view)))).toBe(view._tag === "Emission");
      }
    }
  });
});

/* -------------------------------------------------------------- the rooms */

const LENSES = [FIELD_OF_VIEW.Roughness, FIELD_OF_VIEW.Emission, FIELD_OF_VIEW.Coating];

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
    expect(distanceFor(1, FIELD_OF_VIEW.Roughness)).toBeLessThan(
      distanceFor(1, FIELD_OF_VIEW.Emission),
    );
  });

  it("has nowhere to stand back from nothing", () => {
    for (const lens of LENSES) expect(distanceFor(0, lens)).toBe(0);
  });
});

describe("REACH", () => {
  it("covers the arrangement each room actually stands", () => {
    expect(REACH.Roughness).toBe(reachOf(STANDING_IN.Roughness));
    expect(REACH.Emission).toBe(reachOf(STANDING_IN.Emission));
    expect(REACH.Coating).toBe(reachOf(STANDING_IN.Coating));
  });
});

describe("the eye", () => {
  it("stands outside the arrangement it is looking at, in every room", () => {
    expect(EYE_DISTANCE.Roughness).toBeGreaterThan(REACH.Roughness);
    expect(EYE_DISTANCE.Emission).toBeGreaterThan(REACH.Emission);
    expect(EYE_DISTANCE.Coating).toBeGreaterThan(REACH.Coating);
  });

  it("stands above the floor and looks down at what is lying on it", () => {
    expect(EYE_HEIGHT.Roughness.stands).toBeGreaterThan(EYE_HEIGHT.Roughness.looksAt);
    expect(EYE_HEIGHT.Coating.stands).toBeGreaterThan(EYE_HEIGHT.Coating.looksAt);
  });

  it("orbits a glowing room at the distance that room is framed from", () => {
    expect(EYE_RADIUS).toBe(EYE_DISTANCE.Emission);
  });

  it("stands clear of the near subject of the coated room it is framing", () => {
    // Measured from that subject rather than from the middle of the floor,
    // because that subject is the thing the eye can end up inside of.
    const front = frontOf(STANDING_IN.Coating);

    expect(EYE_DISTANCE.Coating - front.toward).toBeGreaterThan(front.reach);
  });

  it("stands nearer a coated room than fitting its whole floor would ask for", () => {
    expect(EYE_DISTANCE.Coating).toBeLessThan(
      distanceFor(REACH.Coating, FIELD_OF_VIEW.Coating),
    );
  });

  it("sees to the far end of every room, and no nearer than its own nose", () => {
    for (const theme of THEMES) {
      for (const view of KINDS) {
        const input = at(theme, view);
        const eye = camera(input);
        // Nothing in a shell is further from the eye than the furthest point
        // of the shell from the middle plus how far the eye is from it.
        const furthest = match(shell(input).form)
          .with({ _tag: "Corner" }, ({ extent }) => Math.hypot(extent / 2, extent, extent / 2))
          .with({ _tag: "Drum" }, ({ radius, height }) => Math.hypot(radius, height))
          .with({ _tag: "Backdrop" }, ({ size, distance }) =>
            Math.hypot(size / 2, size / 2, distance),
          )
          .exhaustive();

        expect(eye.near).toBeGreaterThan(0);
        expect(eye.far).toBeGreaterThan(furthest + Math.hypot(eye.eye.x, eye.eye.y, eye.eye.z));
      }
    }
  });
});

describe("the lamps", () => {
  it("hang on a ring outside every arrangement a corner stands", () => {
    expect(LAMP_RADIUS).toBeGreaterThan(REACH.Roughness);
    expect(LAMP_RADIUS).toBeGreaterThan(REACH.Coating);
  });

  it("hang on a ring inside the walls at every elevation the pointer can reach", () => {
    // A lamp is above the floor, so the furthest from the middle it ever gets
    // is at the lowest the pointer can carry the ring.
    expect(LAMP_RADIUS * Math.cos(ELEVATION_BOUNDS.lowest)).toBeLessThan(WALL_AT);
  });

  it("all hang inside the room they light, above its floor", () => {
    for (const theme of THEMES) {
      for (const view of Object.values(ROOMS)) {
        const input = at(theme, view);
        const inside = match(shell(input).form)
          .with(
            { _tag: "Corner" },
            ({ wallAt, extent }) =>
              (hangs: Eye) =>
                hangs.x > -wallAt &&
                hangs.z > -wallAt &&
                Math.abs(hangs.x) < extent / 2 &&
                Math.abs(hangs.z) < extent / 2 &&
                hangs.y > 0,
          )
          .with(
            { _tag: "Drum" },
            ({ radius, height }) =>
              (hangs: Eye) =>
                Math.hypot(hangs.x, hangs.z) < radius && hangs.y > 0 && hangs.y < height,
          )
          .with({ _tag: "Backdrop" }, () => () => false)
          .exhaustive();

        for (const hangs of Option.compact(lights(input).map(hangingOf))) {
          expect(inside(hangs)).toBe(true);
        }
      }
    }
  });
});

describe("the walls", () => {
  it("stand behind the arrangement of either corner", () => {
    expect(WALL_AT).toBeGreaterThan(REACH.Roughness);
    expect(WALL_AT).toBeGreaterThan(REACH.Coating);
  });

  it("stand behind the lamps too, so a lamp is never inside one", () => {
    expect(WALL_AT).toBeGreaterThan(LAMP_RADIUS);
  });

  it("run far enough that the eye cannot see past their edges", () => {
    // The floor runs `ROOM_EXTENT` times the wall distance and is centered on
    // the middle of the room, so it reaches half that in every direction.
    expect((WALL_AT * ROOM_EXTENT) / 2).toBeGreaterThan(EYE_DISTANCE.Roughness);
    expect((WALL_AT * ROOM_EXTENT) / 2).toBeGreaterThan(EYE_DISTANCE.Coating);
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
    const half = (FIELD_OF_VIEW.Emission * Math.PI) / 360;
    const steps = 20;

    for (let step = 0; step <= steps; step += 1) {
      const elevation =
        ELEVATION_BOUNDS.lowest +
        (step / steps) * (ELEVATION_BOUNDS.highest - ELEVATION_BOUNDS.lowest);
      const eye = eyeAt({ azimuth: 0, elevation }, EYE_RADIUS);
      const stands = EYE_HEIGHT.Emission.looksAt + eye.y;
      const away = OPEN_ROOM.radius + Math.hypot(eye.x, eye.z);

      expect(stands + away * Math.tan(half - elevation)).toBeLessThan(OPEN_ROOM.height);
    }
  });
});

/* -------------------------------------------------------- the arrangement */

const ARRANGEMENTS = [STANDING_IN.Roughness, STANDING_IN.Emission, STANDING_IN.Coating] as const;

/** How much floor one subject covers, whichever way it is lying. */
const spread = (placement: Placement): number => MESH_REACH * placement.scale;

const between = (one: Placement, other: Placement): number =>
  Math.hypot(one.x - other.x, one.z - other.z);

describe("STANDING_IN", () => {
  it("stands somebody in every room", () => {
    for (const room of ARRANGEMENTS) expect(room.length).toBeGreaterThan(0);
  });

  it("keeps every subject on the floor its own room lays", () => {
    for (const room of ARRANGEMENTS) {
      for (const placement of room) {
        const corner = Math.hypot(placement.x, placement.z) + spread(placement);

        expect(corner).toBeLessThanOrEqual(reachOf(room));
      }
    }
  });

  it("never lets two subjects touch", () => {
    for (const room of ARRANGEMENTS) {
      for (let one = 0; one < room.length; one += 1) {
        for (let other = one + 1; other < room.length; other += 1) {
          const first = room[one];
          const second = room[other];

          if (first === undefined || second === undefined) throw new Error("short");

          expect(between(first, second)).toBeGreaterThan(spread(first) + spread(second));
        }
      }
    }
  });

  it("keeps every subject smaller than the mesh's own size and larger than none", () => {
    for (const room of ARRANGEMENTS) {
      for (const placement of room) {
        expect(placement.scale).toBeGreaterThan(0);
        expect(placement.scale).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stands the lone subject of a roughness room in the middle of the floor", () => {
    const [only] = STANDING_IN.Roughness;

    if (only === undefined) throw new Error("short");

    expect(only.x).toBeCloseTo(0, 12);
    expect(only.z).toBeCloseTo(0, 12);
  });

  it("puts one coated subject in front of the eye and the other behind it", () => {
    const [near, far] = STANDING_IN.Coating;

    if (near === undefined || far === undefined) throw new Error("short");

    expect(towardOf(near)).toBeGreaterThan(0);
    expect(towardOf(far)).toBeLessThan(0);
    // The near one is the bigger of the two as well as the closer, so what is
    // in front reads as in front rather than as merely large.
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("stands one coated subject well off the line the other is on", () => {
    // The far one is meant to be behind the near one, but two of them on one
    // line are one subject with a halo, so they are apart by more than half of
    // what the near one covers.
    const [near, far] = STANDING_IN.Coating;

    if (near === undefined || far === undefined) throw new Error("short");

    const aside = (placement: Placement): number => (placement.x - placement.z) * Math.SQRT1_2;

    expect(Math.abs(aside(near) - aside(far))).toBeGreaterThan(
      (MESH_REACH * near.scale) / 2,
    );
  });

  it("lifts every subject onto the floor, and no higher", () => {
    for (const theme of THEMES) {
      for (const view of Object.values(ROOMS)) {
        for (const subject of subjects(at(theme, view))) {
          expect(subject.transform.position.y).toBeGreaterThan(0);
          expect(subject.transform.position.y).toBeLessThan(subject.transform.scale * MESH_REACH);
        }
      }
    }
  });
});

describe("the hues each room is painted", () => {
  it("gives every subject in a room a hue of its own", () => {
    expect(GLOWING_HUES.length).toBeGreaterThanOrEqual(STANDING_IN.Emission.length);
    expect(COATED_HUES.length).toBeGreaterThanOrEqual(STANDING_IN.Coating.length);
  });

  it("paints every subject somewhere on the wheel", () => {
    for (const hue of [...GLOWING_HUES, ...COATED_HUES]) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("keeps the subjects of a room out of each other's part of the wheel", () => {
    // Three subjects in one family of the wheel read as a mistake rather than
    // as a choice, and two hues a shopper cannot tell apart demonstrate one.
    for (const hues of [GLOWING_HUES, COATED_HUES]) {
      for (let one = 0; one < hues.length; one += 1) {
        for (let other = one + 1; other < hues.length; other += 1) {
          const apart = Math.abs((hues[one] ?? 0) - (hues[other] ?? 0));

          expect(Math.min(apart, 360 - apart)).toBeGreaterThan(40);
        }
      }
    }
  });
});
