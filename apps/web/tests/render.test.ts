/**
 * The one thing that draws a scene.
 *
 * What is pinned is that every number a description carries lands on the
 * graph: as many lamps of the kinds it names, in the order it names them, at
 * the places and strengths it says; its subjects where it stands them wearing
 * what it paints them; its eye, its haze, its spill and what the frame is
 * cleared to. And that the shadows are laid once, and again only when
 * something they depend on has moved.
 */

import { Option, type Rgb } from "@prism/shared";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Light as Lamp,
  Mesh,
  MeshPhysicalMaterial,
  SpotLight,
  SRGBColorSpace,
  Texture,
} from "three";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";
import { LAGS, restingAt } from "../src/features/catalog/artwork/lightring.ts";
import { type Eye, REST_ORBIT, turnedBy } from "../src/features/catalog/artwork/orbit.ts";
import {
  apply,
  type Kit,
  mount,
  type Mounted,
  shadowsMoved,
} from "../src/features/catalog/artwork/render.ts";
import {
  LAMP_RADIUS,
  type Light,
  RING_AT_REST,
  scene,
  type Scene,
  type SceneInput,
  type View,
} from "../src/features/catalog/artwork/scenes.ts";
import { REST } from "../src/features/catalog/artwork/tilt.ts";
import { AT_REST } from "../src/features/catalog/artwork/viewpoint.ts";
import type { Theme } from "../src/shared/theme/use-theme.ts";

const THEMES: readonly Theme[] = ["light", "dark"];

const kitWith = (head: Option<BufferGeometry>): Kit => ({
  environment: new Texture(),
  head,
  grain: new Texture(),
});

/** Everything a page holds, once the mesh has arrived. */
const WHOLE = kitWith(Option.some(new BoxGeometry()));

const SLAB: View = {
  _tag: "Color",
  hex: "#4a90d9",
  finishing: { roughness: 30, coatingNanometers: 0, emission: 20 },
  tilt: REST,
  viewpoint: AT_REST,
};

const ROUGH: View = {
  _tag: "Roughness",
  roughness: 50,
  lamps: restingAt(LAGS, RING_AT_REST, LAMP_RADIUS),
  viewpoint: AT_REST,
};

const GLOW: View = { _tag: "Emission", emission: 50, orbit: REST_ORBIT, viewpoint: AT_REST };

const COAT: View = { _tag: "Coating", coatingNanometers: 300, hueOffset: 0, viewpoint: AT_REST };

const KINDS: readonly View[] = [SLAB, ROUGH, GLOW, COAT];

const at = (theme: Theme, view: View): SceneInput => ({ theme, view });

const mounted = (described: Scene): Mounted =>
  Option.match<Mounted, Mounted>({
    onSome: (built) => built,
    onNone: () => {
      throw new Error("nothing mounted");
    },
  })(mount(WHOLE, described));

const placeOf = (place: Eye): readonly number[] => [place.x, place.y, place.z];

const paintOf = (rgb: Rgb): Color =>
  new Color().setRGB(rgb.red / 255, rgb.green / 255, rgb.blue / 255, SRGBColorSpace);

/** The lamps hanging in a graph, in the order they hang. */
const lampsIn = (built: Mounted): readonly Lamp[] =>
  built.graph.children.filter((child): child is Lamp => child instanceof Lamp);

/** The shapes standing in a graph, in the order they stand. */
const meshesIn = (built: Mounted): readonly Mesh[] =>
  built.graph.children.filter((child): child is Mesh => child instanceof Mesh);

/** The lamps of a graph that lay a shadow, which are the lamps that have one to lay. */
const castingIn = (built: Mounted): readonly (DirectionalLight | SpotLight)[] =>
  lampsIn(built).filter(
    (lamp): lamp is DirectionalLight | SpotLight =>
      (lamp instanceof DirectionalLight || lamp instanceof SpotLight) && lamp.castShadow,
  );

describe("mount", () => {
  it("builds nothing for a room whose mesh has not arrived, and a slab regardless", () => {
    const bare = kitWith(Option.none);

    for (const theme of THEMES) {
      for (const view of [ROUGH, GLOW, COAT]) {
        expect(Option.isNone(mount(bare, scene(at(theme, view))))).toBe(true);
      }

      expect(Option.isSome(mount(bare, scene(at(theme, SLAB))))).toBe(true);
    }
  });

  it("hangs as many lamps as the description names, of the kinds it names, in its order", () => {
    for (const view of KINDS) {
      const described = scene(at("light", view));
      const hung = lampsIn(mounted(described));

      expect(hung.map((lamp) => lamp.type)).toEqual(
        described.lights.map((light) => `${light._tag}Light`),
      );
    }
  });

  it("stands as many shapes as the description has subjects, before the shell", () => {
    for (const view of KINDS) {
      const described = scene(at("light", view));
      const standing = meshesIn(mounted(described));

      expect(standing.length).toBeGreaterThan(described.subjects.length);

      for (const shape of standing.slice(0, described.subjects.length)) {
        expect(shape.castShadow).toBe(true);
        expect(shape.material).toBeInstanceOf(MeshPhysicalMaterial);
      }

      for (const surface of standing.slice(described.subjects.length)) {
        expect(surface.receiveShadow).toBe(true);
      }
    }
  });
});

describe("apply", () => {
  it("puts every number of the description on the graph, under either theme", () => {
    for (const view of KINDS) {
      const built = mounted(scene(at("light", view)));

      for (const theme of THEMES) {
        const described = scene(at(theme, view));
        const frame = apply(built, described);

        expect(frame.scene).toBe(built.graph);
        expect(frame.camera).toBe(built.camera);
        expect(frame.bloom).toEqual(described.bloom);
        expect(frame.clear).toEqual(
          paintOf(described.air.clear.paint).multiplyScalar(described.air.clear.level),
        );
        expect(built.graph.environmentIntensity).toBe(described.air.environment);

        expect(placeOf(built.camera.position)).toEqual(placeOf(described.camera.eye));
        expect(built.camera.fov).toBe(described.camera.fieldOfView);
        expect(built.camera.near).toBe(described.camera.near);
        expect(built.camera.far).toBe(described.camera.far);

        const lamps = lampsIn(built);

        for (const [index, light] of described.lights.entries()) {
          const lamp = lamps[index];

          if (lamp === undefined) throw new Error("short");

          expect(lamp.intensity).toBe(light.intensity);

          match(light)
            .with({ _tag: "Hemisphere" }, ({ sky, ground }) => {
              expect(lamp).toBeInstanceOf(HemisphereLight);
              expect(lamp.color).toEqual(paintOf(sky));

              if (lamp instanceof HemisphereLight) {
                expect(lamp.groundColor).toEqual(paintOf(ground));
              }
            })
            .otherwise(({ color, at: hangs }) => {
              expect(lamp.color).toEqual(paintOf(color));
              expect(placeOf(lamp.position)).toEqual(placeOf(hangs));
            });
        }

        const shapes = meshesIn(built);

        for (const [index, subject] of described.subjects.entries()) {
          const shape = shapes[index];

          if (shape === undefined) throw new Error("short");

          expect(placeOf(shape.position)).toEqual(placeOf(subject.transform.position));
          expect([shape.rotation.x, shape.rotation.y, shape.rotation.z]).toEqual(
            placeOf(subject.transform.rotation),
          );
          expect(shape.rotation.order).toBe(subject.transform.order);
          expect(shape.scale.x).toBe(subject.transform.scale);

          if (shape.material instanceof MeshPhysicalMaterial) {
            expect(shape.material.color).toEqual(paintOf(subject.material.color));
            expect(shape.material.emissive).toEqual(paintOf(subject.material.emissive));
            expect(shape.material.emissiveIntensity).toBe(subject.material.emissiveIntensity);
            expect(shape.material.roughness).toBe(subject.material.roughness);
            expect(shape.material.iridescence).toBe(subject.material.iridescence);
            expect(shape.material.iridescenceThicknessRange).toEqual([
              subject.material.coatingNanometers,
              subject.material.coatingNanometers,
            ]);
            expect(shape.material.envMapIntensity).toBe(subject.material.envIntensity);
          } else {
            throw new Error("not a pigment");
          }
        }

        Option.match<{ near: number; far: number }, void>({
          onSome: ({ near, far }) => {
            expect(built.graph.fog).toBeInstanceOf(Fog);

            if (built.graph.fog instanceof Fog) {
              expect(built.graph.fog.near).toBe(near);
              expect(built.graph.fog.far).toBe(far);
              expect(built.graph.fog.color).toEqual(frame.clear);
            }
          },
          onNone: () => expect(built.graph.fog).toBeNull(),
        })(described.fog);
      }
    }
  });

  it("lays every shadow on the first frame, and leaves it alone while nothing moves", () => {
    for (const view of KINDS) {
      const described = scene(at("light", view));
      const built = mounted(described);

      apply(built, described);

      const casting = castingIn(built);

      expect(casting.length).toBe(
        described.lights.filter((light) =>
          match(light)
            .with({ _tag: "Directional" }, ({ shadow }) => Option.isSome(shadow))
            .with({ _tag: "Spot" }, ({ shadow }) => Option.isSome(shadow))
            .otherwise(() => false),
        ).length,
      );

      for (const lamp of casting) {
        expect(lamp.shadow.needsUpdate).toBe(true);
        // What the renderer does once it has drawn the map.
        lamp.shadow.needsUpdate = false;
      }

      apply(built, described);
      apply(built, scene(at("dark", view)));

      for (const lamp of casting) expect(lamp.shadow.needsUpdate).toBe(false);
    }
  });

  it("lays the shadows again once a subject has moved", () => {
    const built = mounted(scene(at("light", SLAB)));

    apply(built, scene(at("light", SLAB)));

    for (const lamp of castingIn(built)) lamp.shadow.needsUpdate = false;

    apply(built, scene(at("light", { ...SLAB, tilt: { x: 0.1, y: 0.2 } })));

    for (const lamp of castingIn(built)) expect(lamp.shadow.needsUpdate).toBe(true);
  });
});

describe("shadowsMoved", () => {
  const turned = (light: Light): Light =>
    match(light)
      .with({ _tag: "Directional" }, (lamp) => ({ ...lamp, at: { x: 9, y: 9, z: 9 } }))
      .otherwise((lamp) => lamp);

  it("sees nothing moved between two of the same picture", () => {
    for (const view of KINDS) {
      expect(shadowsMoved(scene(at("light", view)), scene(at("light", view)))).toBe(false);
      expect(shadowsMoved(scene(at("light", view)), scene(at("dark", view)))).toBe(false);
    }
  });

  it("sees a subject move", () => {
    expect(
      shadowsMoved(
        scene(at("light", SLAB)),
        scene(at("light", { ...SLAB, tilt: { x: 0.1, y: 0 } })),
      ),
    ).toBe(true);
  });

  it("sees a casting lamp move", () => {
    const described = scene(at("light", GLOW));

    expect(
      shadowsMoved(described, { ...described, lights: described.lights.map(turned) }),
    ).toBe(true);
  });

  it("ignores a lamp that lays no shadow moving", () => {
    const moved: View = {
      ...ROUGH,
      lamps: restingAt(LAGS, turnedBy(RING_AT_REST, 0.4), LAMP_RADIUS),
    };

    expect(shadowsMoved(scene(at("light", ROUGH)), scene(at("light", moved)))).toBe(false);
  });

  it("ignores the eye moving", () => {
    const walked: View = { ...GLOW, orbit: turnedBy(REST_ORBIT, 0.7) };

    expect(shadowsMoved(scene(at("light", GLOW)), scene(at("light", walked)))).toBe(false);
  });

  it("ignores a finisher changing its amount in a room where nothing stands elsewhere", () => {
    expect(
      shadowsMoved(scene(at("light", GLOW)), scene(at("light", { ...GLOW, emission: 90 }))),
    ).toBe(false);
  });
});
