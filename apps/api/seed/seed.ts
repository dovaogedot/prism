/**
 * Fills an empty database with the shop's placeholder data: one demo
 * account with a few past orders, a shelf of reviewers who review and vote
 * on each other's reviews, and the catalog beside this file, which
 * `fetch/fetch-catalog.ts` writes from its sources. Stock, sizes, reviews and
 * votes are drawn from faker under a fixed seed, so two runs against an
 * empty database plant the same shop. A database that already holds
 * products is left alone. Run as a script it seeds the database named by
 * `DATABASE_URL`, sealing with `DATA_ENCRYPTION_KEY`, and copies the
 * pictures under `MEDIA_DIR`.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { faker } from "@faker-js/faker";
import {
  Delivery,
  Email,
  Pricing,
  ShippingMethodCode,
  Slug,
  type Contact,
  type ProductId,
  type ShippingAddress,
  type UserId,
} from "@prism/shared";
import { asc, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { Database, type Database as Db } from "../src/db/client.ts";
import {
  brands,
  categories,
  orderEvents,
  orderLines,
  orders,
  payments,
  productImages,
  productProperties,
  productReviews,
  products,
  reviewVotes,
  shippingMethods,
  users,
} from "../src/db/schema.ts";
import { ShippingMethods } from "../src/modules/orders/shipping.ts";
import { EncryptionKey, FieldCipher } from "../src/platform/cipher.ts";
import { Hasher } from "../src/platform/hasher.ts";
import { ImageStore } from "../src/platform/image-store.ts";
import { ReviewTexts, type ReviewText } from "./review-texts.ts";
import { SeedCatalog } from "./seed-catalog.ts";

/** What one run of the seed did. */
export type SeedReport =
  | Readonly<{ _tag: "Planted"; products: number }>
  | Readonly<{ _tag: "Present"; products: number }>;

/** A seeded account and the name it signs its reviews with. */
type Reviewer = Readonly<{ id: UserId; byline: string }>;

/** A product as the demo orders need it. */
type Shelved = Readonly<{ id: ProductId; slug: Slug; name: string; priceCents: number }>;

export const Seed = {
  DEMO_EMAIL: Email.schema.parse("shopper@prism.test"),
  DEMO_PASSWORD: "correct horse battery staple",
  DEMO_NAME: "Kadri Tamm",
  DEMO_PHONE: "+37251234567",
  DEMO_ADDRESS: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" } satisfies ShippingAddress,
  DEMO_METHOD: ShippingMethodCode.schema.parse("standard"),
  REVIEWER_COUNT: 10,
  FEATURED_COUNT: 8,
  /** How many pictures get their smaller copies made at once. */
  VARIANT_WORKERS: 4,
  /** The share of seeded reviews that get a title and a body. */
  TEXT_SHARE: 0.6,
  /** How likely one reviewer finds another's review helpful. */
  VOTE_CHANCE: 0.3,
  /** The demo shopper's past orders: how many days ago each was placed, and how far it got. */
  DEMO_ORDERS: [
    { daysAgo: 30, status: "delivered" },
    { daysAgo: 21, status: "delivered" },
    { daysAgo: 12, status: "delivered" },
    { daysAgo: 2, status: "shipped" },
  ] as const,

  /** Where the catalog file and, under `media/`, its pictures are. */
  CATALOG_DIR: new URL("./", import.meta.url),

  /**
   * A URL-safe slug for a name, given a numeric suffix when `taken` already
   * holds it. The result is added to `taken`.
   */
  slugOf: (name: string, taken: Set<string>): Slug => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
    let slug = base;

    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;

    taken.add(slug);
    return Slug.schema.parse(slug);
  },

  /** The catalog file, checked against its schema. */
  catalog: async (): Promise<SeedCatalog> =>
    SeedCatalog.schema.parse(JSON.parse(await readFile(new URL("catalog.json", Seed.CATALOG_DIR), "utf8"))),

  /** The instant `days` days before `now`. */
  daysBefore: (now: Date, days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000),

  /** The instant `hours` hours after `start`. */
  hoursAfter: (start: Date, hours: number): Date => new Date(start.getTime() + hours * 60 * 60 * 1000),

  /** Plants everything unless products already exist. */
  run: async (db: Db, mediaDirectory: string, cipher: FieldCipher): Promise<SeedReport> => {
    const [existing] = await db.select({ total: count() }).from(products);
    if (existing !== undefined && existing.total > 0) return { _tag: "Present", products: existing.total };

    faker.seed(42);
    await mkdir(mediaDirectory, { recursive: true });

    const passwordHash = await Hasher.argon2().hash(Seed.DEMO_PASSWORD);
    const people = [
      { email: Seed.DEMO_EMAIL, byline: Seed.DEMO_NAME.split(" ")[0] ?? Seed.DEMO_NAME },
      ...Array.from({ length: Seed.REVIEWER_COUNT }, () => ({
        email: Email.schema.parse(faker.internet.email()),
        byline: `${faker.person.firstName()} ${faker.person.lastName().slice(0, 1)}.`,
      })),
    ];

    const accounts = await db
      .insert(users)
      .values(
        people.map((person) => ({
          email: cipher.seal(person.email),
          emailIndex: cipher.index("account-email", person.email),
          passwordHash,
          ...(person.email === Seed.DEMO_EMAIL
            ? { fullName: cipher.seal(Seed.DEMO_NAME), phone: cipher.seal(Seed.DEMO_PHONE) }
            : {}),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: users.id, emailIndex: users.emailIndex });

    const reviewers: Reviewer[] = [];
    for (const person of people) {
      const index = cipher.index("account-email", person.email);
      const account = accounts.find((row) => row.emailIndex.equals(index));
      if (account !== undefined) reviewers.push({ id: account.id, byline: person.byline });
    }

    const shopper = reviewers[0];
    const catalog = await Seed.catalog();

    const brandSlugs = new Set<string>();
    const brandRows = await db
      .insert(brands)
      .values([...new Set(catalog.categories.map((shelf) => shelf.brand))].map((name) => ({ slug: Seed.slugOf(name, brandSlugs), name })))
      .returning({ id: brands.id, name: brands.name });
    const brandIds = new Map(brandRows.map((row) => [row.name, row.id]));

    const categorySlugs = new Set<string>();
    const productSlugs = new Set<string>();
    const shelved: Shelved[] = [];
    const reviewedByShopper = new Set<ProductId>();

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
          .returning({ id: products.id, slug: products.slug, name: products.name, priceCents: products.priceCents });

        if (product === undefined) continue;
        shelved.push(product);

        const properties = Object.entries(item.properties);
        if (properties.length > 0) {
          await db.insert(productProperties).values(properties.map(([name, value]) => ({ productId: product.id, name, value })));
        }

        await copyFile(new URL(`media/${item.image}`, Seed.CATALOG_DIR), join(mediaDirectory, item.image));
        await db
          .insert(productImages)
          .values({ productId: product.id, file: item.image, alt: item.name, position: 0, isPixelArt: true });

        await Seed.review(db, product.id, reviewers);
        if (shopper !== undefined && (await Seed.hasReviewed(db, product.id, shopper.id))) reviewedByShopper.add(product.id);
      }
    }

    const now = new Date();
    await db
      .update(products)
      .set({ featuredAt: now })
      .where(
        inArray(
          products.id,
          faker.helpers.arrayElements(
            shelved.map((product) => product.id),
            Seed.FEATURED_COUNT,
          ),
        ),
      );

    if (shopper !== undefined) {
      await Seed.demoOrders(
        db,
        cipher,
        shopper.id,
        shelved.filter((product) => !reviewedByShopper.has(product.id)),
        now,
      );
    }

    await Seed.variants(db, ImageStore.create(mediaDirectory));

    return { _tag: "Planted", products: shelved.length };
  },

  /** Makes the smaller copies of every picture that has none, a few pictures at a time. */
  variants: async (db: Db, images: ImageStore): Promise<void> => {
    const pending = await db
      .select({ id: productImages.id, file: productImages.file, isPixelArt: productImages.isPixelArt })
      .from(productImages)
      .where(isNull(productImages.width))
      .orderBy(asc(productImages.id));
    let next = 0;

    const worker = async (): Promise<void> => {
      for (let index = next++; index < pending.length; index = next++) {
        const image = pending[index];
        if (image === undefined) continue;

        const size = await images.makeVariants(image);
        await db.update(productImages).set(size).where(eq(productImages.id, image.id));
      }
    };

    await Promise.all(Array.from({ length: Seed.VARIANT_WORKERS }, worker));
  },

  /**
   * Reviews from a random sample of the reviewers, skewed high like every
   * real distribution, and the helpful votes the other reviewers give them.
   */
  review: async (db: Db, productId: ProductId, reviewers: readonly Reviewer[]): Promise<void> => {
    const sample = faker.helpers.arrayElements(reviewers, { min: 0, max: reviewers.length });
    if (sample.length === 0) return;

    const written = sample.map((reviewer) => {
      const rating = faker.helpers.arrayElement([2, 3, 4, 4, 5, 5, 5] as const);
      const texts: readonly ReviewText[] = ReviewTexts.byRating[rating];
      const text = faker.datatype.boolean(Seed.TEXT_SHARE) ? faker.helpers.arrayElement(texts) : undefined;
      const voters = reviewers.filter((other) => other.id !== reviewer.id && faker.datatype.boolean(Seed.VOTE_CHANCE));

      return { reviewer, rating, text, voters };
    });

    const rows = await db
      .insert(productReviews)
      .values(
        written.map(({ reviewer, rating, text, voters }) => ({
          productId,
          userId: reviewer.id,
          rating,
          authorName: reviewer.byline,
          ...(text === undefined ? {} : { title: text.title, body: text.body }),
          status: "approved" as const,
          helpfulCount: voters.length,
        })),
      )
      .returning({ id: productReviews.id, userId: productReviews.userId });

    const votes = rows.flatMap((row) =>
      (written.find((review) => review.reviewer.id === row.userId)?.voters ?? []).map((voter) => ({
        reviewId: row.id,
        userId: voter.id,
      })),
    );

    if (votes.length > 0) await db.insert(reviewVotes).values(votes);
  },

  hasReviewed: async (db: Db, productId: ProductId, userId: UserId): Promise<boolean> =>
    (
      await db.query.productReviews.findFirst({
        columns: { id: true },
        where: (review, { and, eq }) => and(eq(review.productId, productId), eq(review.userId, userId)),
      })
    ) !== undefined,

  /**
   * The demo shopper's past orders, paid and on their way or delivered, so
   * the order history has entries and the shopper can review at once.
   */
  demoOrders: async (
    db: Db,
    cipher: FieldCipher,
    shopperId: UserId,
    candidates: readonly Shelved[],
    now: Date,
  ): Promise<void> => {
    const contact: Contact = {
      fullName: Seed.DEMO_NAME,
      email: Seed.DEMO_EMAIL,
      phone: Seed.DEMO_PHONE,
    };
    const [method] = await db.select().from(shippingMethods).where(eq(shippingMethods.code, Seed.DEMO_METHOD));
    if (method === undefined) throw new Error(`The ${Seed.DEMO_METHOD} shipping method is missing; run the migrations first.`);
    const option = ShippingMethods.optionOf(method);
    const picked = faker.helpers.arrayElements(candidates, Seed.DEMO_ORDERS.length * 2);

    for (const [index, plan] of Seed.DEMO_ORDERS.entries()) {
      const placedAt = Seed.daysBefore(now, plan.daysAgo);
      const lines = picked.slice(index * 2, index * 2 + 2).map((product) => ({
        product,
        unitPriceCents: product.priceCents,
        quantity: faker.number.int({ min: 1, max: 2 }),
      }));
      if (lines.length === 0) continue;

      const totals = Pricing.totals(lines, option);
      const estimate = Delivery.estimate(placedAt, option);
      const timeline = Seed.timelineOf(plan.status, placedAt);
      const last = timeline[timeline.length - 1];

      const [order] = await db
        .insert(orders)
        .values({
          userId: shopperId,
          status: plan.status,
          shippingMethod: option.code,
          shippingMethodName: option.name,
          estimatedDeliveryFrom: estimate.from,
          estimatedDeliveryTo: estimate.to,
          subtotalCents: totals.subtotalCents,
          shippingCents: totals.shippingCents,
          totalCents: totals.totalCents,
          contact: cipher.seal(contact),
          shippingAddress: cipher.seal(Seed.DEMO_ADDRESS),
          emailIndex: cipher.index("order-email", contact.email),
          trackingNumber: `PR${String(faker.number.int({ min: 0, max: 999_999_999 })).padStart(9, "0")}EE`,
          paymentDueAt: Seed.hoursAfter(placedAt, 0.5),
          createdAt: placedAt,
          statusChangedAt: last?.at ?? placedAt,
        })
        .returning({ id: orders.id });
      if (order === undefined) continue;

      await db.insert(orderLines).values(
        lines.map((line) => ({
          orderId: order.id,
          productId: line.product.id,
          productName: line.product.name,
          productSlug: line.product.slug,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          lineTotalCents: Pricing.lineTotal(line),
        })),
      );
      await db.insert(orderEvents).values(timeline.map((event) => ({ orderId: order.id, status: event.status, createdAt: event.at })));
      await db.insert(payments).values({
        orderId: order.id,
        kind: "charge",
        status: "succeeded",
        amountCents: totals.totalCents,
        provider: "simulated",
        reference: cipher.seal(`pi_simulated_seed_${index + 1}`),
        details: cipher.seal({ card: { brand: "visa", last4: "4242" } }),
        createdAt: placedAt,
        updatedAt: placedAt,
      });
    }
  },

  /** The statuses an order passed through on its way to `status`, a day or so apart. */
  timelineOf: (
    status: "shipped" | "delivered",
    placedAt: Date,
  ): readonly Readonly<{ status: "pending_payment" | "payment_successful" | "processing" | "shipped" | "delivered"; at: Date }>[] => {
    const steps = ["pending_payment", "payment_successful", "processing", "shipped", "delivered"] as const;
    const reached = steps.slice(0, steps.indexOf(status) + 1);
    const hours = [0, 0.05, 6, 24, 72];

    return reached.map((step, index) => ({ status: step, at: Seed.hoursAfter(placedAt, hours[index] ?? 0) }));
  },
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const environment = z
    .object({
      DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
      DATA_ENCRYPTION_KEY: EncryptionKey.schema,
      MEDIA_DIR: z.string().min(1).default("/srv/media"),
    })
    .safeParse(process.env);

  if (!environment.success) {
    process.stderr.write(`${environment.error.issues.map((issue) => issue.message).join("\n")}\n`);
    process.exit(1);
  }

  const { DATABASE_URL, DATA_ENCRYPTION_KEY, MEDIA_DIR } = environment.data;
  const database = Database.open(DATABASE_URL, 2);
  const report = await Seed.run(database.db, MEDIA_DIR, FieldCipher.create(EncryptionKey.bytes(DATA_ENCRYPTION_KEY)));
  await database.close();

  process.stdout.write(
    report._tag === "Planted"
      ? `Seeded ${report.products} products.\n`
      : `Catalog already seeded (${report.products} products).\n`,
  );
}
