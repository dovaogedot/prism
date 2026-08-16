/**
 * Builds a catalog worth browsing: two demo accounts, eight foundries, a
 * seven-branch category tree, a few hundred colors, a generated swatch image
 * for each, and enough reviews that sorting by rating means something.
 *
 * Idempotent — running it twice leaves the same catalog, so `docker compose
 * up` on an existing volume does not double the shop.
 *
 * Note what is never written: hue, saturation, lightness, temperature, reach,
 * weight and every rating. Postgres derives the first six from `hex` and
 * `finish`, and `product_listing` derives the ratings from `product_review`.
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
  categories,
  productImages,
  productReviews,
  products,
  users,
} from "./schema.ts";
import { createRandom, hslToHex, shuffle, slugify, type Random } from "./palette.ts";
import { renderSwatch } from "./swatch.ts";
import {
  BRANDS,
  CATEGORIES,
  DESCRIPTION_NOTES,
  DIRECTION_NOTES,
  FINISHER_BRANCHES,
  FINISHER_NOTES,
  FINISHES,
  FINISH_NOTES,
  INSTRUMENT_NOTES,
  REVIEW_BODIES,
  SHIFTER_BRANCHES,
  type InstrumentSeed,
  type LeafCategorySeed,
} from "./seed-data.ts";
import type { Finish, ProductKind, ShiftDirection } from "@prism/shared";
import { SHIFT_DIRECTIONS } from "@prism/shared";
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
  "ochre@prism.test",
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
    | { kind: "color"; hex: string; finish: Finish }
    | { kind: "finisher"; finish: Finish; durability: number }
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

const planColorsFor = (
  leaf: LeafCategorySeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  planNamed(COLORS_PER_LEAF, leaf, random, takenSlugs, (name, slug) => {
    const finish = random.pick(FINISHES);
    const hex = hslToHex(
      hueWithin(leaf.hue, random),
      random.between(leaf.saturation.from, leaf.saturation.to),
      random.between(leaf.lightness.from, leaf.lightness.to),
    );

    return {
      kind: "color",
      slug,
      name,
      description: [
        `${name}. ${leaf.description}`,
        FINISH_NOTES[finish],
        random.pick(DESCRIPTION_NOTES),
      ].join(" "),
      hex,
      finish,
      priceCents: random.between(6, 48) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 140),
    };
  });

/**
 * One run of finishers per finish, so every finish is buyable back and the
 * radio in the rail never has an empty option.
 */
const planFinishersFor = (
  branch: InstrumentSeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] =>
  FINISHES.flatMap((finish) =>
    planNamed(FINISHERS_PER_FINISH, branch, random, takenSlugs, (name, slug) => ({
      kind: "finisher",
      slug,
      name,
      description: [
        `${name}. ${branch.description}`,
        FINISHER_NOTES[finish],
        random.pick(INSTRUMENT_NOTES),
      ].join(" "),
      finish,
      // How many colors it will see through. The expensive ones last.
      durability: random.between(3, 60),
      priceCents: random.between(9, 70) * 100 + random.pick([0, 50, 99]),
      stockQuantity: random.between(0, 90),
    })),
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

/** The three roots come from migration 0005 — one per `product_kind`. */
const categoryIdBySlug = async (db: Database, slug: string): Promise<string> => {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);

  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`category ${slug} missing`);

  return id;
};

/** Inserts a branch if it is not already there, and returns its id either way. */
const upsertCategory = async (
  db: Database,
  values: Readonly<{
    slug: string;
    name: string;
    description: string;
    parentId: string;
    kind: ProductKind;
    position: number;
  }>,
): Promise<string> => {
  const [inserted] = await db
    .insert(categories)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: categories.id });

  return inserted?.id ?? (await categoryIdBySlug(db, values.slug));
};

/** The variant columns for one planned product, and none of the others'. */
const variantColumnsOf = (planned: PlannedProduct) =>
  match(planned)
    .with({ kind: "color" }, ({ hex, finish }) => ({
      kind: "color" as const,
      hex,
      finish,
    }))
    .with({ kind: "finisher" }, ({ finish, durability }) => ({
      kind: "finisher" as const,
      finish,
      durability,
    }))
    .with({ kind: "shifter" }, ({ direction, arcDegrees }) => ({
      kind: "shifter" as const,
      direction,
      arcDegrees,
    }))
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
  const pending: { categoryId: string; product: PlannedProduct }[] = [];

  /* ------------------------------------------------------------- colors */

  const colorRootId = await categoryIdBySlug(db, "color");

  for (const family of CATEGORIES) {
    const familyId = await upsertCategory(db, {
      slug: family.slug,
      name: family.name,
      description: family.description,
      parentId: colorRootId,
      kind: "color",
      position: CATEGORIES.indexOf(family),
    });

    for (const leaf of family.children) {
      const leafId = await upsertCategory(db, {
        slug: leaf.slug,
        name: leaf.name,
        description: leaf.description,
        parentId: familyId,
        kind: "color",
        position: family.children.indexOf(leaf),
      });

      for (const planned of planColorsFor(leaf, random, takenSlugs)) {
        pending.push({ categoryId: leafId, product: planned });
      }
    }
  }

  /* ---------------------------------------------------------- finishers */

  const finisherRootId = await categoryIdBySlug(db, "finisher");

  for (const branch of FINISHER_BRANCHES) {
    const branchId = await upsertCategory(db, {
      slug: branch.slug,
      name: branch.name,
      description: branch.description,
      parentId: finisherRootId,
      kind: "finisher",
      position: FINISHER_BRANCHES.indexOf(branch),
    });

    for (const planned of planFinishersFor(branch, random, takenSlugs)) {
      pending.push({ categoryId: branchId, product: planned });
    }
  }

  /* ----------------------------------------------------------- shifters */

  const shifterRootId = await categoryIdBySlug(db, "shifter");

  // A nudge and a swing are the same tool at different settings, so the arc
  // range is the only thing that separates the two branches.
  const arcRanges = { nudge: { from: 5, to: 45 }, swing: { from: 90, to: 300 } };

  for (const branch of SHIFTER_BRANCHES) {
    const branchId = await upsertCategory(db, {
      slug: branch.slug,
      name: branch.name,
      description: branch.description,
      parentId: shifterRootId,
      kind: "shifter",
      position: SHIFTER_BRANCHES.indexOf(branch),
    });

    const arc = branch.slug === "nudge" ? arcRanges.nudge : arcRanges.swing;

    for (const planned of planShiftersFor(branch, arc, random, takenSlugs)) {
      pending.push({ categoryId: branchId, product: planned });
    }
  }

  /* ------------------------------------------------------------ insert */

  // Planned per branch, inserted in one shuffled pass. Insertion order is the
  // only thing `created_at` records, and `created_at` is what the default sort
  // falls back to with no search term — so seeding branch by branch would open
  // the shop on sixteen consecutive blacks, then a shelf of tins.
  for (const { categoryId, product: planned } of shuffle(pending, random)) {
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
        categoryId,
        brandId,
        ...variantColumnsOf(planned),
      })
      .onConflictDoNothing()
      .returning({ id: products.id });

    if (inserted === undefined) continue;

    // Only a color has a swatch to render. A finisher and a shifter draw
    // themselves in the browser from what they are, which is one fewer file on
    // the volume and one fewer thing that can disagree with the data.
    if (planned.kind !== "color") continue;

    // Content-addressed, exactly as the upload endpoint would store it.
    const png = renderSwatch(planned.hex);
    const filename = `${createHash("sha256").update(png).digest("hex")}.png`;

    await writeFile(join(mediaDirectory, filename), png);

    await db.insert(productImages).values({
      productId: inserted.id,
      filename,
      alt: `${planned.name}, a ${planned.finish} swatch of ${planned.hex}`,
      position: 0,
    });
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
