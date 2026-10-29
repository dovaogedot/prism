/**
 * Fills an empty database with the shop's placeholder data: one demo
 * account with a few past orders, a shelf of reviewers who review and vote
 * on each other's reviews, and the catalog beside this file, which
 * `fetch/fetch-catalog.ts` writes from its sources. Stock, sizes, reviews and
 * votes are drawn from faker under fixed seeds, so two runs against an
 * empty database plant the same shop. Only the demo account has a password,
 * and every reviewer's address is on the reserved `.example` domain. A
 * database that already holds products keeps its catalog; a seed only moves
 * the reviewers an earlier one left on their drawn addresses. Run as a script it seeds the database named by
 * `DATABASE_URL`, sealing with `DATA_ENCRYPTION_KEY`, and copies the
 * pictures under `MEDIA_DIR`.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { base, en, Faker, faker } from "@faker-js/faker";
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
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { Database, type Database as Db, type Transaction } from "../src/db/client.ts";
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
  sessions,
  shippingMethods,
  users,
} from "../src/db/schema.ts";
import { ShippingMethods } from "../src/modules/orders/shipping.ts";
import { EncryptionKey, FieldCipher } from "../src/platform/cipher.ts";
import { Hasher } from "../src/platform/hasher.ts";
import { ImageStore } from "../src/platform/image-store.ts";
import { ReviewTexts } from "./review-texts.ts";
import { SeedCatalog } from "./seed-catalog.ts";

/** What one run of the seed did. */
export type SeedReport =
  | Readonly<{ _tag: "Planted"; products: number }>
  | Readonly<{ _tag: "Present"; products: number }>;

/** A seeded account and the name it signs its reviews with. */
type Reviewer = Readonly<{ id: UserId; byline: string }>;

/** A product as the demo orders need it. */
type Shelved = Readonly<{ id: ProductId; slug: Slug; name: string; priceCents: number }>;

/** One review as drawn, with the reviewers who find it helpful, before it is written. */
type DrawnReview = Readonly<{
  productId: ProductId;
  reviewer: Reviewer;
  rating: number;
  text: Readonly<{ title: string; body: string }> | undefined;
  voters: readonly Reviewer[];
}>;

export const Seed = {
  DEMO_EMAIL: Email.schema.parse("shopper@prism.test"),
  DEMO_PASSWORD: "correct horse battery staple",
  DEMO_NAME: "Kadri Tamm",
  DEMO_PHONE: "+37251234567",
  DEMO_ADDRESS: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" } satisfies ShippingAddress,
  DEMO_METHOD: ShippingMethodCode.schema.parse("standard"),
  REVIEWER_COUNT: 40,
  FEATURED_COUNT: 8,
  /** How many pictures get their smaller copies made at once. */
  VARIANT_WORKERS: 4,
  /** The most review rows one statement writes; each takes eight parameters, of the 65,534 Postgres allows. */
  REVIEWS_PER_INSERT: 4000,
  /** The most vote rows one statement writes; each takes two parameters. */
  VOTES_PER_INSERT: 16000,
  /** The share of seeded reviews that get a title and a body. */
  TEXT_SHARE: 0.6,
  /** The largest share of the other reviewers that find one review helpful: one with text, and one with stars only. */
  VOTE_SHARE: { text: 0.6, bare: 0.2 },
  /**
   * The seed of the generator the reviewers, their reviews and their votes
   * come from. It is apart from the catalog's, so how many there are never
   * changes a product's stock or size.
   */
  REVIEW_SEED: 7,
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

  /**
   * The reviewers in the order the generator draws them: the address it
   * draws first, then the byline. Drawing exactly this keeps every review and
   * vote the same from one seed to the next.
   */
  drawReviewers: (draw: Faker): readonly Readonly<{ drawn: string; byline: string }>[] =>
    Array.from({ length: Seed.REVIEWER_COUNT }, () => ({
      drawn: draw.internet.email(),
      byline: `${draw.person.firstName()} ${draw.person.lastName().slice(0, 1)}.`,
    })),

  /** A drawn address moved to the reserved `.example` top-level domain, whose inboxes belong to nobody. */
  exampleAddressOf: (drawn: string): Email => Email.schema.parse(drawn.replace(/\.[^.@]+$/, ".example")),

  /**
   * Moves every reviewer an earlier seed made at its drawn address to its
   * `.example` address, with no password and no live session, so nobody
   * signs in as one. Resolves to how many it moved; once they are moved, it
   * moves none.
   */
  retireDrawnAddresses: async (db: Db, cipher: FieldCipher, now: Date): Promise<number> => {
    const draw = new Faker({ locale: [en, base], seed: Seed.REVIEW_SEED });
    let moved = 0;

    for (const { drawn } of Seed.drawReviewers(draw)) {
      const address = Seed.exampleAddressOf(drawn);

      await db.transaction(async (tx) => {
        const [account] = await tx
          .update(users)
          .set({ email: cipher.seal(address), emailIndex: cipher.index("account-email", address), passwordHash: null })
          .where(eq(users.emailIndex, cipher.index("account-email", Email.schema.parse(drawn))))
          .returning({ id: users.id });
        if (account === undefined) return;

        await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: "password_reset" })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)));
        moved += 1;
      });
    }

    return moved;
  },

  /** The instant `days` days before `now`. */
  daysBefore: (now: Date, days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000),

  /** The instant `hours` hours after `start`. */
  hoursAfter: (start: Date, hours: number): Date => new Date(start.getTime() + hours * 60 * 60 * 1000),

  /**
   * Plants everything in one transaction unless products already exist, so a
   * seed stopped part way leaves an empty catalog. Either way, it then makes
   * the smaller copies of every picture that has none. Each planted category
   * and the start of the pictures' step are reported to `onProgress`.
   */
  run: async (db: Db, mediaDirectory: string, cipher: FieldCipher, onProgress: (line: string) => void): Promise<SeedReport> => {
    const images = ImageStore.create(mediaDirectory);
    const [existing] = await db.select({ total: count() }).from(products);
    if (existing !== undefined && existing.total > 0) {
      const moved = await Seed.retireDrawnAddresses(db, cipher, new Date());
      if (moved > 0) onProgress(`Moved ${moved} seeded reviewers to .example addresses, with no password.`);
      await Seed.variants(db, images);
      return { _tag: "Present", products: existing.total };
    }

    faker.seed(42);
    const draw = new Faker({ locale: [en, base], seed: Seed.REVIEW_SEED });
    await mkdir(mediaDirectory, { recursive: true });

    // Only the demo shopper signs in; the reviewers have no password.
    const passwordHash = await Hasher.argon2().hash(Seed.DEMO_PASSWORD);
    const people = [
      { email: Seed.DEMO_EMAIL, byline: Seed.DEMO_NAME.split(" ")[0] ?? Seed.DEMO_NAME },
      ...Seed.drawReviewers(draw).map(({ drawn, byline }) => ({ email: Seed.exampleAddressOf(drawn), byline })),
    ];

    const planted = await db.transaction(async (tx) => {
      const accounts = await tx
        .insert(users)
        .values(
          people.map((person) => ({
            email: cipher.seal(person.email),
            emailIndex: cipher.index("account-email", person.email),
            ...(person.email === Seed.DEMO_EMAIL
              ? { passwordHash, fullName: cipher.seal(Seed.DEMO_NAME), phone: cipher.seal(Seed.DEMO_PHONE) }
              : {}),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: users.id, emailIndex: users.emailIndex });

      const reviewers: Reviewer[] = [];
      // Found by its address: an account that already existed is not among the rows the insert returns.
      let shopper: Reviewer | undefined;
      for (const person of people) {
        const index = cipher.index("account-email", person.email);
        const account = accounts.find((row) => row.emailIndex.equals(index));
        if (account === undefined) continue;

        const reviewer = { id: account.id, byline: person.byline };
        reviewers.push(reviewer);
        if (person.email === Seed.DEMO_EMAIL) shopper = reviewer;
      }

      const catalog = await Seed.catalog();

      const brandSlugs = new Set<string>();
      const brandRows = await tx
        .insert(brands)
        .values([...new Set(catalog.categories.map((shelf) => shelf.brand))].map((name) => ({ slug: Seed.slugOf(name, brandSlugs), name })))
        .returning({ id: brands.id, name: brands.name });
      const brandIds = new Map(brandRows.map((row) => [row.name, row.id]));

      const categorySlugs = new Set<string>();
      const productSlugs = new Set<string>();
      const shelved: Shelved[] = [];
      const reviewedByShopper = new Set<ProductId>();
      // One category's reviews, written together once its products are in.
      const drawn: DrawnReview[] = [];

      for (const shelf of catalog.categories) {
        const [category] = await tx
          .insert(categories)
          .values({ slug: Seed.slugOf(shelf.name, categorySlugs), name: shelf.name })
          .returning({ id: categories.id });
        const brandId = brandIds.get(shelf.brand);
        if (category === undefined || brandId === undefined) continue;

        for (const item of shelf.products) {
          const [product] = await tx
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
            await tx.insert(productProperties).values(properties.map(([name, value]) => ({ productId: product.id, name, value })));
          }

          await copyFile(new URL(`media/${item.image}`, Seed.CATALOG_DIR), join(mediaDirectory, item.image));
          await tx
            .insert(productImages)
            .values({ productId: product.id, file: item.image, alt: item.name, position: 0, isPixelArt: true });

          for (const review of Seed.drawReviews(product.id, reviewers, draw)) {
            drawn.push(review);
            if (review.reviewer.id === shopper?.id) reviewedByShopper.add(product.id);
          }
        }

        await Seed.writeReviews(tx, drawn);
        onProgress(`Planted ${shelf.name}: ${shelf.products.length} products, ${drawn.length} reviews.`);
        drawn.length = 0;
      }

      const now = new Date();
      await tx
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
          tx,
          cipher,
          shopper.id,
          shelved.filter((product) => !reviewedByShopper.has(product.id)),
          now,
        );
      }

      return shelved.length;
    });

    onProgress("Making the smaller copies of the pictures.");
    await Seed.variants(db, images);

    return { _tag: "Planted", products: planted };
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
   * Reviews of one product from a sample of the reviewers, skewed high like
   * every real distribution, and the helpful votes the other reviewers give
   * them. Most products get a few reviews and some get many; most reviews get
   * a few votes and some get many, a review with text more than one with
   * stars only. No body repeats on one product. Every draw comes from `draw`.
   */
  drawReviews: (productId: ProductId, reviewers: readonly Reviewer[], draw: Faker): DrawnReview[] => {
    // Squaring and cubing a uniform draw keeps most results small and a few large.
    const sample = draw.helpers.arrayElements(reviewers, Math.round(reviewers.length * draw.number.float() ** 2));
    const bodies = new Set<string>();

    return sample.map((reviewer) => {
      const rating = draw.helpers.arrayElement([2, 3, 4, 4, 5, 5, 5] as const);
      const composed = draw.datatype.boolean(Seed.TEXT_SHARE)
        ? ReviewTexts.compose(ReviewTexts.byRating[rating], (pieces) => draw.helpers.arrayElement(pieces))
        : undefined;
      // A body this product already shows leaves the review with stars only.
      const text = composed === undefined || bodies.has(composed.body) ? undefined : composed;
      if (text !== undefined) {
        bodies.add(text.body);
      }

      const others = reviewers.filter((other) => other.id !== reviewer.id);
      const share = text === undefined ? Seed.VOTE_SHARE.bare : Seed.VOTE_SHARE.text;
      const voters = draw.helpers.arrayElements(others, Math.round(others.length * share * draw.number.float() ** 3));

      return { productId, reviewer, rating, text, voters };
    });
  },

  /** Writes drawn reviews as approved, with their helpful votes, many rows per statement. */
  writeReviews: async (db: Db | Transaction, drawn: readonly DrawnReview[]): Promise<void> => {
    const keyOf = (productId: ProductId, userId: UserId) => `${productId}:${userId}`;
    const votersOf = new Map(drawn.map((review) => [keyOf(review.productId, review.reviewer.id), review.voters]));

    for (let start = 0; start < drawn.length; start += Seed.REVIEWS_PER_INSERT) {
      const rows = await db
        .insert(productReviews)
        .values(
          drawn.slice(start, start + Seed.REVIEWS_PER_INSERT).map(({ productId, reviewer, rating, text, voters }) => ({
            productId,
            userId: reviewer.id,
            rating,
            authorName: reviewer.byline,
            ...(text === undefined ? {} : { title: text.title, body: text.body }),
            status: "approved" as const,
            helpfulCount: voters.length,
          })),
        )
        .returning({ id: productReviews.id, productId: productReviews.productId, userId: productReviews.userId });

      const votes = rows.flatMap((row) =>
        (votersOf.get(keyOf(row.productId, row.userId)) ?? []).map((voter) => ({ reviewId: row.id, userId: voter.id })),
      );

      for (let first = 0; first < votes.length; first += Seed.VOTES_PER_INSERT) {
        await db.insert(reviewVotes).values(votes.slice(first, first + Seed.VOTES_PER_INSERT));
      }
    }
  },

  /**
   * The demo shopper's past orders, paid and on their way or delivered, so
   * the order history has entries and the shopper can review at once.
   */
  demoOrders: async (
    db: Db | Transaction,
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
  const report = await Seed.run(database.db, MEDIA_DIR, FieldCipher.create(EncryptionKey.bytes(DATA_ENCRYPTION_KEY)), (line) => {
    process.stdout.write(`${line}\n`);
  });
  await database.close();

  process.stdout.write(
    report._tag === "Planted"
      ? `Seeded ${report.products} products.\n`
      : `Catalog already seeded (${report.products} products).\n`,
  );
}
