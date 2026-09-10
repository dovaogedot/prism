/**
 * Builds a catalog worth browsing: two demo accounts, a shelf of foundries,
 * the colors, finishers and gears `plan.ts` plans, the stills of every
 * color's and every finisher's scene, and enough reviews that sorting by
 * rating means something.
 *
 * Plants the catalog only into a database that holds no products, so `docker
 * compose up` on an existing volume does not double the shop. The stills are
 * the exception: they belong to `apps/api/stills` rather than to the database,
 * so every run replaces whichever of them differ from the files there.
 *
 * Note what is never written: hue, saturation, lightness, temperature, reach,
 * grain, weight and every rating. Postgres derives the first seven from the
 * hex and the three amounts, and `product_listing` derives the ratings from
 * `product_review`.
 */

import { fileURLToPath } from "node:url";
import { count } from "drizzle-orm";
import argon2 from "argon2";
import { match } from "ts-pattern";
import { createDatabase, type Database } from "./client.ts";
import {
  brands,
  colors,
  finishers,
  productReviews,
  products,
  shifters,
  users,
} from "./schema.ts";
import { createRandom, type Random } from "./palette.ts";
import { planCatalog, SEED, type PlannedProduct } from "./plan.ts";
import { BRANDS, REVIEW_BODIES } from "./seed-data.ts";
import { refreshStills, stillJobs, type StillDirectories } from "./stills.ts";

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
    // Exactly the one column the finisher is sold for; the other two stay absent.
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

/**
 * Plants every planned product, in the order of the plan, each under a brand
 * drawn from `random`.
 */
const seedCatalog = async (
  db: Database,
  plan: readonly PlannedProduct[],
  random: Random,
): Promise<void> => {
  await db
    .insert(brands)
    .values(BRANDS.map((brand) => ({ ...brand })))
    .onConflictDoNothing();

  const brandRows = await db.select({ id: brands.id }).from(brands);
  const brandIds = brandRows.map((row) => row.id);

  for (const planned of plan) {
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

/** What the seed found the catalog to be. */
export type CatalogReport =
  | Readonly<{ _tag: "Planted"; products: number; reviews: number }>
  | Readonly<{ _tag: "Present"; products: number }>;

/** What one run of the seed did. */
export type SeedReport = Readonly<{
  catalog: CatalogReport;
  /** How many products had their stills replaced. */
  refreshed: number;
}>;

const plant = async (
  db: Database,
  plan: readonly PlannedProduct[],
  random: Random,
): Promise<CatalogReport> => {
  const reviewerIds = await seedUsers(db);
  await seedCatalog(db, plan, random);
  await seedReviews(db, reviewerIds);

  const [productTotal] = await db.select({ total: count() }).from(products);
  const [reviewTotal] = await db.select({ total: count() }).from(productReviews);

  return {
    _tag: "Planted",
    products: productTotal?.total ?? 0,
    reviews: reviewTotal?.total ?? 0,
  };
};

/**
 * Plants the catalog into an empty database, and brings every product's
 * stills up to date with the files in `directories.stills`.
 *
 * Safe to run on every start: a database that already holds products keeps
 * them, and only stills whose files differ are replaced. Every
 * value is drawn from a seeded generator, so two runs against an empty
 * database plant the same catalog. Rejects if a still of a planted product is
 * missing from `directories.stills`.
 */
export const seed = async (
  db: Database,
  directories: StillDirectories,
): Promise<SeedReport> => {
  const random = createRandom(SEED);
  const plan = planCatalog(random);

  const [existing] = await db.select({ total: count() }).from(products);
  const present = existing?.total ?? 0;

  const catalog: CatalogReport =
    present > 0 ? { _tag: "Present", products: present } : await plant(db, plan, random);

  return { catalog, refreshed: await refreshStills(db, directories, stillJobs(plan)) };
};

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const url = process.env["DATABASE_URL"];
  const media = process.env["MEDIA_DIR"] ?? "/srv/media";
  // Rendered by `npm run stills` and committed, so it travels with this file.
  const stills = fileURLToPath(new URL("../../stills", import.meta.url));

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const database = createDatabase(url, 4);
  const report = await seed(database.db, { stills, media });
  await database.close();

  const catalog = match(report.catalog)
    .with(
      { _tag: "Planted" },
      ({ products: planted, reviews }) => `Seeded ${planted} products and ${reviews} reviews.`,
    )
    .with({ _tag: "Present" }, ({ products: present }) => `Catalog already seeded (${present} products).`)
    .exhaustive();

  process.stdout.write(`${catalog} Stored new stills for ${report.refreshed} products.\n`);
}
