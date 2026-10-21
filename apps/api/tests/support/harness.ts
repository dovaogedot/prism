/**
 * Integration test harness: a real Postgres in a container, the real
 * migrations, and the real application. Only the pieces that would reach
 * the outside world are substituted: the clock, the mailer, the hasher, the
 * message queue, the payment gateway and the address lookup. Requests go
 * through `app.inject`, which runs the whole Fastify pipeline without a
 * socket. The background jobs never start on their own; `settle` and
 * `jobs.housekeeping.run` do their work when a test asks.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Email, Slug, type UserId } from "@prism/shared";
import { generateSync } from "otplib";
import { App, type Jobs, type MountedRoute } from "../../src/app.ts";
import { Config } from "../../src/config.ts";
import { Database, type DatabaseHandle } from "../../src/db/client.ts";
import { Migrations } from "../../src/db/migrate.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { AddressVerifier, type FakeAddressVerifier } from "../../src/platform/address-verifier.ts";
import {
  brands,
  categories,
  productImages,
  productProperties,
  productReviews,
  products,
  users,
} from "../../src/db/schema.ts";
import { FieldCipher } from "../../src/platform/cipher.ts";
import { Clock, type MutableClock } from "../../src/platform/clock.ts";
import { PasswordHash, type Hasher } from "../../src/platform/hasher.ts";
import { Mailer, type MemoryMailer } from "../../src/platform/mailer.ts";
import { PaymentGateway, type FakeGateway } from "../../src/platform/payment-gateway.ts";
import { MessageQueue, type MemoryQueue } from "../../src/platform/queue.ts";
import { TotpService } from "../../src/platform/totp.ts";

/** Where the harness clock starts, so every expiry is reasoned from one instant. */
export const TEST_START = new Date("2026-08-07T12:00:00.000Z");

/** A password that satisfies the policy, for tests that are not about the policy. */
export const VALID_PASSWORD = "correct horse battery staple";

/** Argon2 costs ~50 ms per call; this keeps the shape at no cost. */
export const fastHasher: Hasher = {
  hash: async (plaintext) => PasswordHash.schema.parse(`fake:${Buffer.from(plaintext).toString("base64")}`),
  verify: async (storedHash, plaintext) => storedHash === `fake:${Buffer.from(plaintext).toString("base64")}`,
  fakeVerify: async () => undefined,
};

/** The real application over a real Postgres, with the slow and external parts faked. */
export type Harness = Readonly<{
  app: FastifyInstance;
  database: DatabaseHandle;
  clock: MutableClock;
  mailer: MemoryMailer;
  queue: MemoryQueue;
  gateway: FakeGateway;
  addressVerifier: FakeAddressVerifier;
  jobs: Jobs;
  /** Every route the app mounted. */
  routes: readonly MountedRoute[];
  /** Publishes the outbox and delivers the queue until neither has anything left. */
  settle: () => Promise<void>;
  config: Config;
  /** The application's own cipher, for tests that write or read sealed columns. */
  cipher: FieldCipher;
  /** A live TOTP code for the harness clock, which is not the wall clock. */
  totpCodeFor: (secret: string) => string;
  mediaDirectory: string;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}>;

/** An environment the config parser accepts, pointed at a throwaway database. */
export const testEnvironment = (databaseUrl: string, mediaDirectory: string, rateLimitScale = 1_000_000) =>
  ({
    LOG_LEVEL: "fatal" as const,
    HOST: "127.0.0.1",
    PORT: 0,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_SIZE: 5,
    PUBLIC_WEB_URL: "https://localhost:3000",
    JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
    JWT_ISSUER: "prism",
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 604800,
    TWO_FACTOR_CHALLENGE_TTL_SECONDS: 300,
    PASSWORD_RESET_TTL_SECONDS: 1800,
    SMTP_HOST: "unused",
    SMTP_PORT: 1025,
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_SECURE: false,
    MAIL_FROM: "Prism <noreply@prism.test>",
    SUPPORT_EMAIL: Email.schema.parse("support@prism.test"),
    RECAPTCHA_SECRET_KEY: "",
    OAUTH_GOOGLE_CLIENT_ID: "",
    OAUTH_GOOGLE_CLIENT_SECRET: "",
    OAUTH_GITHUB_CLIENT_ID: "",
    OAUTH_GITHUB_CLIENT_SECRET: "",
    // Effectively off: the limiter keys on the client address and cannot tell
    // one test from the next. The throttling tests build their own app.
    RATE_LIMIT_SCALE: rateLimitScale,
    MEDIA_DIR: mediaDirectory,
    DATA_ENCRYPTION_KEY: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    // Never dialed: the harness hands the app a memory queue.
    RABBITMQ_URL: "amqp://unused",
    // Empty: payments are off unless a test hands the app a gateway.
    STRIPE_SECRET_KEY: "",
    STRIPE_PUBLISHABLE_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_WEBHOOK_SECRET_FILE: "",
    STRIPE_TIMEOUT_MS: 10_000,
    ADDRESS_LOOKUP_URL: "",
    GUEST_CART_TTL_SECONDS: 30 * 24 * 60 * 60,
    PAYMENT_WINDOW_SECONDS: 1800,
    PAYMENTS_MODE: "stripe" as const,
    STAFF_VERIFICATION_TTL_SECONDS: 8 * 60 * 60,
  }) as const;

/** Every table the tests write to, in an order that respects the foreign keys. */
const MUTABLE_TABLES = [
  "audit_event",
  "review_vote",
  "address",
  "outbox_message",
  "payment",
  "order_event",
  "order_line",
  "customer_order",
  "cart_item",
  "cart",
  "refresh_token",
  "password_reset_token",
  "session",
  "oauth_identity",
  "product_review",
  "product_image",
  "product_property",
  "product",
  "brand",
  "category",
  "app_user",
  "shipping_method",
];

/** The delivery options the migration inserts, which every test starts from. */
const DEFAULT_SHIPPING_METHODS = `
  INSERT INTO shipping_method (code, name, price_cents, free_from_cents, min_days, max_days, position) VALUES
    ('standard', 'Standard', 490, 5000, 2, 4, 0),
    ('express', 'Express', 990, NULL, 1, 2, 1)`;

/** What a suite can choose about its harness. */
export type HarnessOptions = Readonly<{
  /** Defaults to a fast stand-in; a suite about stored passwords passes the real one. */
  hasher?: Hasher;
}>;

/**
 * Starts a Postgres container, migrates it, and builds the app against it.
 * `reset` empties the tables and the media directory and moves the clock an
 * hour on; `stop` takes the container down.
 */
export const startHarness = async (options: HarnessOptions = {}): Promise<Harness> => {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const mediaDirectory = await mkdtemp(join(tmpdir(), "prism-media-"));

  const config = Config.fromEnvironment(testEnvironment(container.getConnectionUri(), mediaDirectory));
  const database = Database.open(config.database.url, config.database.poolSize);
  const cipher = FieldCipher.create(config.encryptionKey);
  await Migrations.apply(database.db, cipher);

  const clock = Clock.mutable(TEST_START);
  const mailer = Mailer.memory();
  const queue = MessageQueue.memory(Topology.declarations());
  const gateway = PaymentGateway.fake();
  const addressVerifier = AddressVerifier.fake();
  const { app, jobs, routes } = await App.build({
    config,
    database,
    overrides: { clock, mailer, hasher: options.hasher ?? fastHasher, queue, gateway, addressVerifier },
  });

  let epoch = TEST_START.getTime();

  return {
    app,
    database,
    clock,
    mailer,
    queue,
    gateway,
    addressVerifier,
    jobs,
    routes,
    config,
    cipher,
    mediaDirectory,

    settle: async () => {
      // A handler may enqueue the next message, so this runs until a round moves nothing.
      for (let round = 0; round < 20; round += 1) {
        const published = await jobs.relay.flush();
        const delivered = await queue.drain();
        if (published === 0 && delivered === 0) return;
      }

      throw new Error("The outbox and the queue did not settle in 20 rounds.");
    },

    totpCodeFor: (secret) =>
      generateSync({
        secret,
        period: TotpService.PERIOD_SECONDS,
        digits: 6,
        epoch: Math.floor(clock.now().getTime() / 1000),
      }),

    reset: async () => {
      await database.sql.unsafe(`TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      await database.sql.unsafe(DEFAULT_SHIPPING_METHODS);
      await rm(mediaDirectory, { recursive: true, force: true });
      await mkdir(mediaDirectory, { recursive: true });
      epoch += 60 * 60 * 1000;
      clock.set(new Date(epoch));
      mailer.clear();
      queue.clear();
      gateway.clear();
      addressVerifier.clear();
    },

    stop: async () => {
      await app.close();
      await database.close();
      await container.stop();
      await rm(mediaDirectory, { recursive: true, force: true });
    },
  };
};

export const jsonOf = (response: { body: string }): Record<string, unknown> => JSON.parse(response.body);

/** Reads a Set-Cookie value by name from an inject response. */
export const cookieValue = (response: { cookies: readonly unknown[] }, name: string): string => {
  for (const cookie of response.cookies) {
    if (
      typeof cookie === "object" &&
      cookie !== null &&
      "name" in cookie &&
      cookie.name === name &&
      "value" in cookie &&
      typeof cookie.value === "string"
    ) {
      return cookie.value;
    }
  }

  return "";
};

/** Opens an account and hands back the response along with the token it granted. */
export const registerUser = async (harness: Harness, email: string, password: string = VALID_PASSWORD) => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, captchaToken: "test-token" },
  });

  const body = jsonOf(response);

  return {
    response,
    accessToken: typeof body["accessToken"] === "string" ? body["accessToken"] : "",
    refreshToken: cookieValue(response, "prism_refresh"),
  };
};

/** One product as a test describes it; everything but the name and price has a default. */
export type ProductSeed = Readonly<{
  slug: string;
  name: string;
  description?: string;
  priceCents: number;
  stock?: number;
  category?: string;
  brand?: string;
  properties?: Readonly<Record<string, string>>;
  images?: readonly string[];
  /** One review per star value listed, each from its own reviewer. */
  ratings?: readonly number[];
}>;

/** A slug for a name a test writes in words. */
const slugOf = (name: string): Slug => Slug.schema.parse(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));

/** Plants the given products, creating whatever categories, brands and reviewers they name. */
export const seedCatalog = async (harness: Harness, seeds: readonly ProductSeed[]): Promise<void> => {
  const { db } = harness.database;

  for (const seed of seeds) {
    const categoryName = seed.category ?? "Things";
    const brandName = seed.brand ?? "Acme";

    await db.insert(categories).values({ slug: slugOf(categoryName), name: categoryName }).onConflictDoNothing();
    await db.insert(brands).values({ slug: slugOf(brandName), name: brandName }).onConflictDoNothing();

    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slugOf(categoryName)));
    const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slugOf(brandName)));
    if (category === undefined || brand === undefined) throw new Error("seed lookup failed");

    const [product] = await db
      .insert(products)
      .values({
        slug: Slug.schema.parse(seed.slug),
        name: seed.name,
        description: seed.description ?? `${seed.name} description`,
        priceCents: seed.priceCents,
        stock: seed.stock ?? 10,
        categoryId: category.id,
        brandId: brand.id,
        weightGrams: 1000,
        widthMm: 254,
        heightMm: 127,
        depthMm: 25,
      })
      .returning({ id: products.id });
    if (product === undefined) throw new Error("product insert returned no row");

    const properties = Object.entries(seed.properties ?? {});
    if (properties.length > 0) {
      await db.insert(productProperties).values(properties.map(([name, value]) => ({ productId: product.id, name, value })));
    }

    const images = seed.images ?? [];
    if (images.length > 0) {
      await db.insert(productImages).values(images.map((file, position) => ({ productId: product.id, file, alt: seed.name, position })));
    }

    for (const [index, rating] of (seed.ratings ?? []).entries()) {
      const reviewer = await insertUser(harness, `reviewer-${seed.slug}-${index}@example.com`);

      await db
        .insert(productReviews)
        .values({ productId: product.id, userId: reviewer, rating, authorName: `Reviewer ${index + 1}`, status: "approved" });
    }
  }
};

/** Writes an account straight to the table, sealed the way the API seals it, and hands back its id. */
export const insertUser = async (harness: Harness, email: string): Promise<UserId> => {
  const address = Email.schema.parse(email);
  const [row] = await harness.database.db
    .insert(users)
    .values({ email: harness.cipher.seal(address), emailIndex: harness.cipher.index("account-email", address) })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("user insert returned no row");

  return row.id;
};

/** The blind index sign-in finds the account registered under `email` by. */
export const emailIndexOf = (harness: Harness, email: string): Buffer =>
  harness.cipher.index("account-email", Email.schema.parse(email));

/** The id of the account registered under `email`, found the way sign-in finds it. */
export const userIdOf = async (harness: Harness, email: string): Promise<UserId | undefined> => {
  const [row] = await harness.database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailIndex, harness.cipher.index("account-email", Email.schema.parse(email))));

  return row?.id;
};
