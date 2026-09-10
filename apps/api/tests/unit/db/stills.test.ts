import { STILL_ANGLES, type StillSubject } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { createRandom } from "../../../src/db/palette.ts";
import { planCatalog, SEED, type PlannedProduct } from "../../../src/db/plan.ts";
import { stillAlt, stillJobs } from "../../../src/db/stills.ts";

const COMMON = { description: "", priceCents: 100, stockQuantity: 1 } as const;

const COLOR: PlannedProduct = {
  ...COMMON,
  kind: "color",
  slug: "void-black",
  name: "Void Black",
  hex: "#0a0a0a",
  roughness: 40,
  coatingNanometers: 0,
  emission: 0,
};

const FINISHER: PlannedProduct = {
  ...COMMON,
  kind: "finisher",
  slug: "mirror-varnish",
  name: "Mirror Varnish",
  applies: "roughness",
  roughness: 8,
};

const SHIFTER: PlannedProduct = {
  ...COMMON,
  kind: "shifter",
  slug: "quarter-swing",
  name: "Quarter Swing",
  direction: "cw",
  arcDegrees: 90,
};

describe("stillJobs", () => {
  it("renders what a color and a finisher are made of, and nothing else of them", () => {
    expect(stillJobs([COLOR, FINISHER])).toEqual([
      {
        slug: "void-black",
        subject: {
          kind: "color",
          hex: "#0a0a0a",
          roughness: 40,
          coatingNanometers: 0,
          emission: 0,
        },
      },
      {
        slug: "mirror-varnish",
        subject: { kind: "finisher", applies: "roughness", roughness: 8 },
      },
    ]);
  });

  it("passes over a shifter, which has no scene", () => {
    expect(stillJobs([SHIFTER, COLOR, SHIFTER]).map((job) => job.slug)).toEqual([
      "void-black",
    ]);
  });

  it("names every color and finisher the seed plants, once each", () => {
    const plan = planCatalog(createRandom(SEED));
    const jobs = stillJobs(plan);

    expect(jobs.map((job) => job.slug)).toEqual(
      plan.filter((planned) => planned.kind !== "shifter").map((planned) => planned.slug),
    );
    expect(new Set(jobs.map((job) => job.slug)).size).toBe(jobs.length);
  });
});

describe("planCatalog", () => {
  it("plans the same catalog from the same seed", () => {
    expect(planCatalog(createRandom(SEED))).toEqual(planCatalog(createRandom(SEED)));
  });

  it("plans all three kinds", () => {
    const kinds = new Set(planCatalog(createRandom(SEED)).map((planned) => planned.kind));

    expect(kinds).toEqual(new Set(["color", "finisher", "shifter"]));
  });

  it("leaves the generator where every run leaves it", () => {
    const first = createRandom(SEED);
    const second = createRandom(SEED);

    planCatalog(first);
    planCatalog(second);

    expect(first.next()).toBe(second.next());
  });
});

describe("stillAlt", () => {
  const [FRONT] = STILL_ANGLES;

  it("says whose picture it is, what is in it and where it is seen from", () => {
    expect(
      stillAlt(
        "Void Black",
        { kind: "color", hex: "#0a0a0a", roughness: 40, coatingNanometers: 0, emission: 0 },
        FRONT,
      ),
    ).toBe("Void Black on a slab standing in a lit room, seen from the front");
  });

  it("describes each finisher's room by what stands in it", () => {
    const subjects: readonly StillSubject[] = [
      { kind: "finisher", applies: "roughness", roughness: 8 },
      { kind: "finisher", applies: "coating", coatingNanometers: 300 },
      { kind: "finisher", applies: "emission", emission: 60 },
    ];

    expect(subjects.map((subject) => stillAlt("It", subject, FRONT))).toEqual([
      "It done to a gray shape in a lit corner, seen from the front",
      "It done to two painted shapes in a lit corner, seen from the front",
      "It done to three shapes glowing in a dim room, seen from the front",
    ]);
  });
});
