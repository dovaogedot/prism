/**
 * Builds a catalog worth browsing: two demo accounts, a shelf of foundries, a
 * few hundred colors with a generated swatch image each, the tins and gears
 * that work on them, and enough reviews that sorting by rating means something.
 *
 * The palettes below are how a plausible color gets invented — a patch of HSL
 * space and some words to name it with. None of that is stored: a color keeps
 * its hex, and which family it lands in is the database's answer, not a label
 * chosen here.
 *
 * Idempotent — running it twice leaves the same catalog, so `docker compose
 * up` on an existing volume does not double the shop.
 *
 * Note what is never written: hue, saturation, lightness, temperature, reach,
 * grain, weight and every rating. Postgres derives the first seven from the
 * hex and the three amounts, and `product_listing` derives the ratings from
 * `product_review`.
 */

import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { count, eq } from "drizzle-orm";
import argon2 from "argon2";
import { createDatabase, type Database } from "./client.ts";
import {
  brands,
  colors,
  finishers,
  productImages,
  productReviews,
  products,
  shifters,
  users,
} from "./schema.ts";
import { createRandom, hslToHex, shuffle, slugify, type Random } from "./palette.ts";
import { renderSwatch } from "./swatch.ts";
import { finisherImages } from "./finish-art.ts";
import {
  BRANDS,
  CATEGORIES,
  DESCRIPTION_NOTES,
  DIRECTION_NOTES,
  FINISHER_BRANCHES,
  FINISHER_NOTES,
  FINISHES,
  INSTRUMENT_NOTES,
  REVIEW_BODIES,
  SHIFTER_BRANCHES,
  type InstrumentSeed,
  type LeafCategorySeed,
} from "./seed-data.ts";
import type {
  Finish,
  FinishApplication,
  ProductKind,
  ShiftDirection,
} from "@prism/shared";
import {
  EMISSION_BOUNDS,
  EMISSION_SPEAKS,
  FINISH_BANDS,
  FLUORESCENCE_FLOOR,
  COATING_BOUNDS,
  COATING_ROUGHNESS_CEILING,
  MATTE_FLOOR,
  Option,
  parseHex,
  ROUGHNESS_BOUNDS,
  saturationOf,
  SHIFT_DIRECTIONS,
  toRgb,
  type HexColor,
} from "@prism/shared";
import { match } from "ts-pattern";

const SEED = 20260807;
const COLORS_PER_LEAF = 16;
const FINISHERS_PER_FINISH = 4;
const SHIFTERS_PER_BRANCH = 12;
const DEMO_PASSWORD = "colors are not paint";

const DEMO_ACCOUNTS = [
  { email: "admin@prism.test", role: "admin" as const },
  { email: "shopper@prism.test", role: "customer" as const },
];

/** Extra reviewers so ratings are not all from the same two people. */
const REVIEWER_EMAILS = [
  "iris@prism.test",
  "hex@prism.test",
  "sable@prism.test",
  "ocher@prism.test",
  "indigo@prism.test",
  "cerise@prism.test",
];

/** Hue arcs may wrap through 0°, so interpolation has to go the long way round. */
const hueWithin = (
  arc: Readonly<{ from: number; to: number }>,
  random: Random,
): number => {
  const span = arc.to >= arc.from ? arc.to - arc.from : 360 - arc.from + arc.to;
  return (arc.from + random.between(0, span)) % 360;
};

/** The three amounts a finish is made of, which a color has and a tin leaves. */
type Finishing = Readonly<{
  roughness: number;
  coatingNanometers: number;
  emission: number;
}>;

/** What every product has, whatever kind it turns out to be. */
type PlannedCommon = Readonly<{
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  stockQuantity: number;
}>;

/** Mirrors `ProductSpec`, so a planned product cannot be half a variant. */
type PlannedProduct = PlannedCommon &
  Readonly<
    | {
        kind: "color";
        hex: string;
        roughness: number;
        coatingNanometers: number;
        emission: number;
      }
    | ({ kind: "finisher" } & FinishApplication)
    | { kind: "shifter"; direction: ShiftDirection; arcDegrees: number }
  >;

/**
 * Names are generated from a branch's own vocabulary, so the same generator
 * serves all three kinds. Returns fewer than asked for rather than looping
 * forever when a small vocabulary runs out of unused combinations.
 */
const planNamed = <A>(
  wanted: number,
  words: Readonly<{ adjectives: readonly string[]; nouns: readonly string[] }>,
  random: Random,
  takenSlugs: Set<string>,
  build: (name: string, slug: string) => A,
): readonly A[] => {
  const planned: A[] = [];
  let attempts = 0;

  while (planned.length < wanted && attempts < wanted * 40) {
    attempts += 1;

    const name = `${random.pick(words.adjectives)} ${random.pick(words.nouns)}`;
    const slug = slugify(name);

    if (takenSlugs.has(slug)) continue;
    takenSlugs.add(slug);

    planned.push(build(name, slug));
  }

  return planned;
};

/** Three colors in ten carry a coating; the rest of the shelf is bare paint. */
const COATED_IN_TEN = 3;

/** And rather fewer glow, which is what makes the ones that do worth stocking. */
const GLOWING_IN_TEN = 2;

/** The saturation Postgres will derive from a hex this file just composed. */
const saturationOfHex = (hex: string): number =>
  Option.match<HexColor, number>({
    onSome: (parsed) => saturationOf(toRgb(parsed)),
    onNone: () => 0,
  })(parseHex(hex));

/**
 * The three amounts one color is made of.
 *
 * Two of the three are constrained by physics rather than by taste, and both
 * constraints run the same way — a finish that has nothing to happen in does
 * not happen. Fluorescence needs a band, so only a vivid enough pigment is
 * offered the roll. Interference needs a reflection, so a coated color is
 * given a surface smooth enough to have one; an uncoated color's roughness is
 * free across the whole axis.
 */
const planFinish = (random: Random, saturation: number): Finishing => {
  const coatingNanometers =
    random.between(1, 10) <= COATED_IN_TEN
      ? random.between(COATING_BOUNDS.min, COATING_BOUNDS.max)
      : 0;

  return {
    roughness: random.between(
      ROUGHNESS_BOUNDS.min,
      coatingNanometers > 0 ? COATING_ROUGHNESS_CEILING : ROUGHNESS_BOUNDS.max,
    ),
    coatingNanometers,
    // Never a barely-there glow: a pigment that fluoresces does it visibly or
    // is not sold as one.
    emission:
      saturation >= FLUORESCENCE_FLOOR && random.between(1, 10) <= GLOWING_IN_TEN
        ? random.between(EMISSION_SPEAKS, EMISSION_BOUNDS.max)
        : 0,
  };
};

const planColorsFor = (
  leaf: LeafCategorySeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  planNamed(COLORS_PER_LEAF, leaf, random, takenSlugs, (name, slug) => {
    const hex = hslToHex(
      hueWithin(leaf.hue, random),
      random.between(leaf.saturation.from, leaf.saturation.to),
      random.between(leaf.lightness.from, leaf.lightness.to),
    );
    // Read back off the hex rather than off the roll that made it: the hex is
    // what gets stored, and it is what the constraint on the glow is checked
    // against.
    const finish = planFinish(random, saturationOfHex(hex));

    return {
      kind: "color",
      slug,
      name,
      description: [`${name}. ${leaf.description}`, random.pick(DESCRIPTION_NOTES)].join(
        " ",
      ),
      hex,
      ...finish,
      priceCents: random.between(6, 48) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 140),
    };
  });

/**
 * The amounts one tin leaves behind.
 *
 * Rolled inside the band the finish names, so a run of gloss tins is a run of
 * genuinely different products — one leaves a surface at 20 and the next at 15,
 * and a shopper who wants the second is not served by being sold the first.
 *
 * One amount and no others, because a tin does one thing: the two it is not
 * sold for are absent rather than zero, which is what makes "which finish is
 * this" a column rather than a threshold.
 */
const planFinisherFinish = (
  finish: Finish,
  random: Random,
): FinishApplication => {
  const band = FINISH_BANDS[finish];
  const amount = random.between(band.range.min, band.range.max);

  return match(band.property)
    .with("roughness", () => ({ applies: "roughness" as const, roughness: amount }))
    .with("coating", () => ({ applies: "coating" as const, coatingNanometers: amount }))
    .with("emission", () => ({ applies: "emission" as const, emission: amount }))
    .exhaustive();
};

/**
 * One run of finishers per finish, so every part of the space a finish name
 * covers has tins in it.
 */
const planFinishersFor = (
  branch: InstrumentSeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  FINISHES.flatMap((finish) =>
    planNamed(FINISHERS_PER_FINISH, branch, random, takenSlugs, (name, slug) => {
      const finishing = planFinisherFinish(finish, random);

      return {
        kind: "finisher",
        slug,
        name,
        description: [
          `${name}. ${branch.description}`,
          FINISHER_NOTES[finish],
          random.pick(INSTRUMENT_NOTES),
        ].join(" "),
        ...finishing,
        priceCents: random.between(9, 70) * 100 + random.pick([0, 50, 99]),
        stockQuantity: random.between(0, 90),
      };
    }),
  );

/** Nudges turn a color a little; swings turn it into somebody else's problem. */
const planShiftersFor = (
  branch: InstrumentSeed,
  arc: Readonly<{ from: number; to: number }>,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  planNamed(SHIFTERS_PER_BRANCH, branch, random, takenSlugs, (name, slug) => {
    const direction = random.pick(SHIFT_DIRECTIONS);

    return {
      kind: "shifter",
      slug,
      name,
      description: [
        `${name}. ${branch.description}`,
        DIRECTION_NOTES[direction],
        random.pick(INSTRUMENT_NOTES),
      ].join(" "),
      direction,
      arcDegrees: random.between(arc.from, arc.to),
      priceCents: random.between(12, 90) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 70),
    };
  });

const seedUsers = async (db: Database): Promise<readonly string[]> => {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const everyone = [
    ...DEMO_ACCOUNTS,
    ...REVIEWER_EMAILS.map((email) => ({ email, role: "customer" as const })),
  ];

  await db
    .insert(users)
    .values(everyone.map((account) => ({ ...account, passwordHash })))
    .onConflictDoNothing();

  const rows = await db.select({ id: users.id, email: users.email }).from(users);

  return rows
    .filter((row) => REVIEWER_EMAILS.includes(row.email))
    .map((row) => row.id);
};

/**
 * Writes the row that holds whatever this kind of product is made of.
 *
 * The base row is already in; this puts its variant beside it, in the one
 * table that has columns for it.
 */
const insertVariant = (
  db: Database,
  productId: string,
  planned: PlannedProduct,
): Promise<unknown> =>
  match(planned)
    .with({ kind: "color" }, ({ hex, roughness, coatingNanometers, emission }) =>
      db.insert(colors).values({ productId, hex, roughness, coatingNanometers, emission }),
    )
    // Exactly the one column the tin is sold for; the other two stay absent.
    .with({ kind: "finisher", applies: "roughness" }, ({ roughness }) =>
      db.insert(finishers).values({ productId, roughness }),
    )
    .with({ kind: "finisher", applies: "coating" }, ({ coatingNanometers }) =>
      db.insert(finishers).values({ productId, coatingNanometers }),
    )
    .with({ kind: "finisher", applies: "emission" }, ({ emission }) =>
      db.insert(finishers).values({ productId, emission }),
    )
    .with({ kind: "shifter" }, ({ direction, arcDegrees }) =>
      db.insert(shifters).values({ productId, direction, arcDegrees }),
    )
    .exhaustive();

const seedCatalog = async (
  db: Database,
  mediaDirectory: string,
): Promise<void> => {
  const random = createRandom(SEED);

  await db
    .insert(brands)
    .values(BRANDS.map((brand) => ({ ...brand })))
    .onConflictDoNothing();

  const brandRows = await db.select({ id: brands.id, slug: brands.slug }).from(brands);
  const brandIds = brandRows.map((row) => row.id);

  await mkdir(mediaDirectory, { recursive: true });

  const takenSlugs = new Set<string>();
  const pending: PlannedProduct[] = [];

  for (const palette of CATEGORIES) {
    for (const leaf of palette.children) {
      pending.push(...planColorsFor(leaf, random, takenSlugs));
    }
  }

  for (const branch of FINISHER_BRANCHES) {
    pending.push(...planFinishersFor(branch, random, takenSlugs));
  }

  // A nudge and a swing are the same tool at different settings, so the arc
  // range is the only thing that separates the two runs.
  const arcRanges = { nudge: { from: 5, to: 45 }, swing: { from: 90, to: 300 } };

  for (const branch of SHIFTER_BRANCHES) {
    const arc = branch.slug === "nudge" ? arcRanges.nudge : arcRanges.swing;
    pending.push(...planShiftersFor(branch, arc, random, takenSlugs));
  }

  /* ------------------------------------------------------------ insert */

  // Planned per branch, inserted in one shuffled pass. Insertion order is the
  // only thing `created_at` records, and `created_at` is what the default sort
  // falls back to with no search term — so seeding branch by branch would open
  // the shop on sixteen consecutive blacks, then a shelf of tins.
  for (const planned of shuffle(pending, random)) {
    const brandId = brandIds[random.between(0, brandIds.length - 1)];
    if (brandId === undefined) throw new Error("no brands seeded");

    const [inserted] = await db
      .insert(products)
      .values({
        slug: planned.slug,
        name: planned.name,
        description: planned.description,
        priceCents: planned.priceCents,
        stockQuantity: planned.stockQuantity,
        brandId,
        kind: planned.kind,
      })
      .onConflictDoNothing()
      .returning({ id: products.id });

    if (inserted === undefined) continue;

    await insertVariant(db, inserted.id, planned);

    // A color is one swatch of itself. A finisher has no color, so what there
    // is to show is the effect — one picture of it and four of it over
    // ordinary pigments. A shifter changes no surface, so it has neither and
    // is drawn in the browser from its own two numbers.
    const gallery = match(planned)
      .with({ kind: "color" }, ({ name, hex }) => [
        { png: renderSwatch(hex), alt: `${name}, a swatch of ${hex}` },
      ])
      .with({ kind: "finisher" }, finisherImages)
      .with({ kind: "shifter" }, () => [])
      .exhaustive();

    for (const [position, image] of gallery.entries()) {
      // Content-addressed, exactly as the upload endpoint would store it.
      const filename = `${createHash("sha256").update(image.png).digest("hex")}.png`;

      await writeFile(join(mediaDirectory, filename), image.png);

      await db.insert(productImages).values({
        productId: inserted.id,
        filename,
        alt: image.alt,
        position,
      });
    }
  }
};

const seedReviews = async (
  db: Database,
  reviewerIds: readonly string[],
): Promise<void> => {
  if (reviewerIds.length === 0) return;

  const random = createRandom(SEED + 1);
  const productRows = await db.select({ id: products.id }).from(products);

  const rows = productRows.flatMap((product) => {
    const reviewCount = random.between(0, reviewerIds.length);

    // Sample distinct reviewers; the unique index forbids two per person.
    const chosen = [...reviewerIds]
      .map((id) => ({ id, order: random.next() }))
      .sort((left, right) => left.order - right.order)
      .slice(0, reviewCount);

    return chosen.map((reviewer) => ({
      productId: product.id,
      userId: reviewer.id,
      // Skewed high, like every real review distribution.
      rating: random.pick([3, 4, 4, 5, 5, 5, 2]),
      body: random.pick(REVIEW_BODIES),
    }));
  });

  for (let index = 0; index < rows.length; index += 500) {
    await db
      .insert(productReviews)
      .values(rows.slice(index, index + 500))
      .onConflictDoNothing();
  }
};

/**
 * Fills an empty database with the catalog, and writes a swatch for each color.
 *
 * Does nothing to a database that already holds products, so it is safe to run
 * on every start. Every value is drawn from a seeded generator, so two runs
 * against an empty database produce the same catalog.
 */
export const seed = async (
  db: Database,
  mediaDirectory: string,
): Promise<Readonly<{ products: number; reviews: number }>> => {
  const existing = await db.select({ total: count() }).from(products);

  if ((existing[0]?.total ?? 0) > 0) {
    return { products: existing[0]?.total ?? 0, reviews: 0 };
  }

  const reviewerIds = await seedUsers(db);
  await seedCatalog(db, mediaDirectory);
  await seedReviews(db, reviewerIds);

  const [productTotal] = await db.select({ total: count() }).from(products);
  const [reviewTotal] = await db.select({ total: count() }).from(productReviews);

  return {
    products: productTotal?.total ?? 0,
    reviews: reviewTotal?.total ?? 0,
  };
};

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const url = process.env["DATABASE_URL"];
  const mediaDirectory = process.env["MEDIA_DIR"] ?? "/srv/media";

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const database = createDatabase(url, 4);
  const report = await seed(database.db, mediaDirectory);
  await database.close();

  process.stdout.write(
    report.reviews === 0 && report.products > 0
      ? `Catalog already seeded (${report.products} products).\n`
      : `Seeded ${report.products} products and ${report.reviews} reviews.\n`,
  );
}
