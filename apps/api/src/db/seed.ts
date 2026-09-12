/**
 * Fills an empty database with placeholder data: one demo account, a shelf
 * of reviewers, and a catalog drawn from faker under a fixed seed, so two
 * runs against an empty database plant the same shop. A database that
 * already holds products is left alone. Run as a script it seeds the
 * database named by `DATABASE_URL` and writes images under `MEDIA_DIR`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { faker } from "@faker-js/faker";
import { count } from "drizzle-orm";
import { Database, type Database as Db } from "./client.ts";
import {
  brands,
  categories,
  productImages,
  productProperties,
  productReviews,
  products,
  users,
} from "./schema.ts";
import { Hasher } from "../platform/hasher.ts";

/** What one run of the seed did. */
export type SeedReport =
  | Readonly<{ _tag: "Planted"; products: number }>
  | Readonly<{ _tag: "Present"; products: number }>;

/** A placeholder category and the properties every product filed under it carries. */
export type SeedCategory = Readonly<{ name: string; properties: Readonly<Record<string, () => string>> }>;

export const Seed = {
  DEMO_EMAIL: "shopper@prism.test",
  DEMO_PASSWORD: "correct horse battery staple",
  PRODUCT_COUNT: 96,
  BRAND_COUNT: 8,
  REVIEWER_COUNT: 10,

  /** A property whose value is drawn from a fixed list. */
  choice:
    (values: readonly string[]): (() => string) =>
    () =>
      faker.helpers.arrayElement(values),

  /**
   * The categories, each with its own property vocabulary, so the facets
   * differ from one shelf to the next. The names are placeholder data; the
   * shop reads whatever names the rows carry.
   */
  categories: (): readonly SeedCategory[] => [
    {
      name: "Computers",
      properties: {
        processor: Seed.choice(["Intel Core i5", "Intel Core i7", "AMD Ryzen 5", "AMD Ryzen 7", "Apple M3"]),
        memory: Seed.choice(["8 GB", "16 GB", "32 GB", "64 GB"]),
        storage: Seed.choice(["256 GB SSD", "512 GB SSD", "1 TB SSD", "2 TB SSD"]),
        color: faker.color.human,
      },
    },
    {
      name: "Electronics",
      properties: {
        connectivity: Seed.choice(["Wi-Fi", "Bluetooth", "Wired", "5G"]),
        power: Seed.choice(["Battery", "Rechargeable", "Mains"]),
        warranty: Seed.choice(["1 year", "2 years", "3 years"]),
        color: faker.color.human,
      },
    },
    {
      name: "Home",
      properties: {
        room: Seed.choice(["Kitchen", "Living room", "Bedroom", "Bathroom", "Office"]),
        material: faker.commerce.productMaterial,
        color: faker.color.human,
      },
    },
    {
      name: "Kids",
      properties: {
        age: Seed.choice(["0-2", "3-5", "6-9", "10+"]),
        material: faker.commerce.productMaterial,
        color: faker.color.human,
      },
    },
    {
      name: "Sports",
      properties: {
        sport: Seed.choice(["Running", "Cycling", "Swimming", "Football", "Yoga", "Hiking"]),
        size: Seed.choice(["XS", "S", "M", "L", "XL"]),
        color: faker.color.human,
      },
    },
    {
      name: "Automotive",
      properties: {
        vehicle: Seed.choice(["Car", "Motorcycle", "Truck", "Bicycle"]),
        part: Seed.choice(["Interior", "Exterior", "Engine", "Wheels", "Electrical"]),
        fit: Seed.choice(["Universal", "Model-specific"]),
      },
    },
  ],

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

  /** A flat-color placeholder picture with the product's name on it. */
  imageSvg: (name: string, color: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="${color}"/>
  <text x="320" y="250" font-family="sans-serif" font-size="32" fill="#ffffff" text-anchor="middle">${name.replace(/[<>&"]/g, "")}</text>
</svg>
`,

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

    const categorySlugs = new Set<string>();
    const shelves = Seed.categories();
    const categoryRows = await db
      .insert(categories)
      .values(shelves.map((shelf) => ({ slug: Seed.slugOf(shelf.name, categorySlugs), name: shelf.name })))
      .returning({ id: categories.id });

    const brandSlugs = new Set<string>();
    const brandRows = await db
      .insert(brands)
      .values(
        faker.helpers
          .uniqueArray(faker.company.name, Seed.BRAND_COUNT)
          .map((name) => ({ slug: Seed.slugOf(name, brandSlugs), name })),
      )
      .returning({ id: brands.id });

    const productSlugs = new Set<string>();
    for (let index = 1; index <= Seed.PRODUCT_COUNT; index += 1) {
      const name = faker.commerce.productName();
      const slug = Seed.slugOf(name, productSlugs);
      const shelfIndex = faker.number.int({ min: 0, max: shelves.length - 1 });
      const shelf = shelves[shelfIndex];
      const category = categoryRows[shelfIndex];
      if (shelf === undefined || category === undefined) continue;

      const [product] = await db
        .insert(products)
        .values({
          slug,
          name,
          description: faker.commerce.productDescription(),
          priceCents: Math.round(Number(faker.commerce.price({ min: 5, max: 900 })) * 100),
          stock: faker.number.int({ min: 0, max: 40 }),
          categoryId: category.id,
          brandId: faker.helpers.arrayElement(brandRows).id,
          weightGrams: faker.number.int({ min: 50, max: 20_000 }),
          widthMm: faker.number.int({ min: 20, max: 1200 }),
          heightMm: faker.number.int({ min: 20, max: 1200 }),
          depthMm: faker.number.int({ min: 10, max: 800 }),
        })
        .returning({ id: products.id });

      if (product === undefined) continue;

      await db.insert(productProperties).values(
        Object.entries(shelf.properties).map(([propertyName, draw]) => ({
          productId: product.id,
          name: propertyName,
          value: draw(),
        })),
      );

      const imageCount = faker.number.int({ min: 1, max: 3 });
      for (let position = 0; position < imageCount; position += 1) {
        const file = `${slug}-${position + 1}.svg`;
        await writeFile(join(mediaDirectory, file), Seed.imageSvg(name, faker.color.rgb()));
        await db.insert(productImages).values({ productId: product.id, file, alt: name, position });
      }

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
    }

    return { _tag: "Planted", products: Seed.PRODUCT_COUNT };
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
