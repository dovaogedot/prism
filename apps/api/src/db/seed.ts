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
  FINISHES,
  FINISH_NOTES,
  REVIEW_BODIES,
  type LeafCategorySeed,
} from "./seed-data.ts";

const SEED = 20260807;
const COLORS_PER_LEAF = 16;
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

type PlannedProduct = Readonly<{
  slug: string;
  name: string;
  description: string;
  hex: string;
  finish: (typeof FINISHES)[number];
  priceCents: number;
  stockQuantity: number;
}>;

const planColorsFor = (
  leaf: LeafCategorySeed,
  random: Random,
  takenSlugs: Set<string>,
): readonly PlannedProduct[] => {
  const planned: PlannedProduct[] = [];
  let attempts = 0;

  while (planned.length < COLORS_PER_LEAF && attempts < COLORS_PER_LEAF * 40) {
    attempts += 1;

    const name = `${random.pick(leaf.adjectives)} ${random.pick(leaf.nouns)}`;
    const slug = slugify(name);

    if (takenSlugs.has(slug)) continue;
    takenSlugs.add(slug);

    const finish = random.pick(FINISHES);
    const hex = hslToHex(
      hueWithin(leaf.hue, random),
      random.between(leaf.saturation.from, leaf.saturation.to),
      random.between(leaf.lightness.from, leaf.lightness.to),
    );

    planned.push({
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
    });
  }

  return planned;
};

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

  for (const parent of CATEGORIES) {
    const [parentRow] = await db
      .insert(categories)
      .values({
        slug: parent.slug,
        name: parent.name,
        description: parent.description,
        position: CATEGORIES.indexOf(parent),
      })
      .onConflictDoNothing()
      .returning({ id: categories.id });

    const parentId =
      parentRow?.id ??
      (
        await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, parent.slug))
          .limit(1)
      )[0]?.id;

    if (parentId === undefined) throw new Error(`category ${parent.slug} missing`);

    for (const leaf of parent.children) {
      const [leafRow] = await db
        .insert(categories)
        .values({
          slug: leaf.slug,
          name: leaf.name,
          description: leaf.description,
          parentId,
          position: parent.children.indexOf(leaf),
        })
        .onConflictDoNothing()
        .returning({ id: categories.id });

      const leafId =
        leafRow?.id ??
        (
          await db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.slug, leaf.slug))
            .limit(1)
        )[0]?.id;

      if (leafId === undefined) throw new Error(`category ${leaf.slug} missing`);

      for (const planned of planColorsFor(leaf, random, takenSlugs)) {
        pending.push({ categoryId: leafId, product: planned });
      }
    }
  }

  // Planned per branch, inserted in one shuffled pass. Insertion order is the
  // only thing `created_at` records, and `created_at` is what the default sort
  // falls back to with no search term — so seeding branch by branch would open
  // the shop on sixteen consecutive blacks.
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
        hex: planned.hex,
        finish: planned.finish,
      })
      .onConflictDoNothing()
      .returning({ id: products.id });

    if (inserted === undefined) continue;

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
      ? `Catalog already seeded (${report.products} colors).\n`
      : `Seeded ${report.products} colors and ${report.reviews} reviews.\n`,
  );
}
