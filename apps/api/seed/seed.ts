/**
 * Fills an empty database with the shop's placeholder data: one demo
 * account, a shelf of reviewers, and the catalog beside this file, which
 * `fetch/fetch-catalog.ts` writes from its sources. Stock, sizes and
 * reviews are drawn from faker under a fixed seed, so two runs against an
 * empty database plant the same shop. A database that already holds
 * products is left alone. Run as a script it seeds the database named by
 * `DATABASE_URL` and copies the pictures under `MEDIA_DIR`.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { faker } from "@faker-js/faker";
import { count } from "drizzle-orm";
import { Database, type Database as Db } from "../src/db/client.ts";
import {
  brands,
  categories,
  productImages,
  productProperties,
  productReviews,
  products,
  users,
} from "../src/db/schema.ts";
import { SeedCatalog } from "./seed-catalog.ts";
import { Hasher } from "../src/platform/hasher.ts";

/** What one run of the seed did. */
export type SeedReport =
  | Readonly<{ _tag: "Planted"; products: number }>
  | Readonly<{ _tag: "Present"; products: number }>;

export const Seed = {
  DEMO_EMAIL: "shopper@prism.test",
  DEMO_PASSWORD: "correct horse battery staple",
  REVIEWER_COUNT: 10,

  /** Where the catalog file and, under `media/`, its pictures are. */
  CATALOG_DIR: new URL("./", import.meta.url),

  /**
   * A URL-safe slug for a name, given a numeric suffix when `taken` already
   * holds it. The result is added to `taken`.
   */
  slugOf: (name: string, taken: Set<string>): string => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
    let slug = base;

    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;

    taken.add(slug);
    return slug;
  },

  /** The catalog file, checked against its schema. */
  catalog: async (): Promise<SeedCatalog> =>
    SeedCatalog.schema.parse(JSON.parse(await readFile(new URL("catalog.json", Seed.CATALOG_DIR), "utf8"))),

  /** Plants everything unless products already exist. */
  run: async (db: Db, mediaDirectory: string): Promise<SeedReport> => {
    const [existing] = await db.select({ total: count() }).from(products);
    if (existing !== undefined && existing.total > 0) return { _tag: "Present", products: existing.total };

    faker.seed(42);
    await mkdir(mediaDirectory, { recursive: true });

    const passwordHash = await Hasher.argon2().hash(Seed.DEMO_PASSWORD);
    const reviewers = await db
      .insert(users)
      .values([
        { email: Seed.DEMO_EMAIL, passwordHash },
        ...Array.from({ length: Seed.REVIEWER_COUNT }, () => ({
          email: faker.internet.email().toLowerCase(),
          passwordHash,
        })),
      ])
      .onConflictDoNothing()
      .returning({ id: users.id });

    const catalog = await Seed.catalog();

    const brandSlugs = new Set<string>();
    const brandRows = await db
      .insert(brands)
      .values([...new Set(catalog.categories.map((shelf) => shelf.brand))].map((name) => ({ slug: Seed.slugOf(name, brandSlugs), name })))
      .returning({ id: brands.id, name: brands.name });
    const brandIds = new Map(brandRows.map((row) => [row.name, row.id]));

    const categorySlugs = new Set<string>();
    const productSlugs = new Set<string>();
    let planted = 0;

    for (const shelf of catalog.categories) {
      const [category] = await db
        .insert(categories)
        .values({ slug: Seed.slugOf(shelf.name, categorySlugs), name: shelf.name })
        .returning({ id: categories.id });
      const brandId = brandIds.get(shelf.brand);
      if (category === undefined || brandId === undefined) continue;

      for (const item of shelf.products) {
        const [product] = await db
          .insert(products)
          .values({
            slug: Seed.slugOf(item.name, productSlugs),
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            stock: faker.number.int({ min: 0, max: 40 }),
            categoryId: category.id,
            brandId,
            weightGrams: faker.number.int({ min: 2, max: 500 }),
            widthMm: faker.number.int({ min: 20, max: 300 }),
            heightMm: faker.number.int({ min: 20, max: 300 }),
            depthMm: faker.number.int({ min: 1, max: 100 }),
          })
          .returning({ id: products.id });

        if (product === undefined) continue;

        const properties = Object.entries(item.properties);
        if (properties.length > 0) {
          await db.insert(productProperties).values(properties.map(([name, value]) => ({ productId: product.id, name, value })));
        }

        await copyFile(new URL(`media/${item.image}`, Seed.CATALOG_DIR), join(mediaDirectory, item.image));
        await db.insert(productImages).values({ productId: product.id, file: item.image, alt: item.name, position: 0 });

        // Skewed high, like every real review distribution.
        const reviewerSample = faker.helpers.arrayElements(reviewers, { min: 0, max: reviewers.length });
        if (reviewerSample.length > 0) {
          await db.insert(productReviews).values(
            reviewerSample.map((reviewer) => ({
              productId: product.id,
              userId: reviewer.id,
              rating: faker.helpers.arrayElement([2, 3, 4, 4, 5, 5, 5]),
            })),
          );
        }

        planted += 1;
      }
    }

    return { _tag: "Planted", products: planted };
  },
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env["DATABASE_URL"];
  const media = process.env["MEDIA_DIR"] ?? "/srv/media";

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const database = Database.open(url, 2);
  const report = await Seed.run(database.db, media);
  await database.close();

  process.stdout.write(
    report._tag === "Planted"
      ? `Seeded ${report.products} products.\n`
      : `Catalog already seeded (${report.products} products).\n`,
  );
}
