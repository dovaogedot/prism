/**
 * Integration test harness: a real Postgres in a container, the real
 * migrations, and the real application. Only the pieces that would reach
 * the outside world are substituted: the clock, the mailer and the hasher.
 * Requests go through `app.inject`, which runs the whole Fastify pipeline
 * without a socket.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Email, Slug } from "@prism/shared";
import { generateSync } from "otplib";
import { App } from "../../src/app.ts";
import { Config } from "../../src/config.ts";
import { Database, type DatabaseHandle } from "../../src/db/client.ts";
import { Migrations } from "../../src/db/migrate.ts";
import {
  brands,
  categories,
  productImages,
  productProperties,
  productReviews,
  products,
  users,
} from "../../src/db/schema.ts";
import { Clock, type MutableClock } from "../../src/platform/clock.ts";
import { PasswordHash, type Hasher } from "../../src/platform/hasher.ts";
import { Mailer, type MemoryMailer } from "../../src/platform/mailer.ts";
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
  config: Config;
  /** A live TOTP code for the harness clock, which is not the wall clock. */
  totpCodeFor: (secret: string) => string;
  mediaDirectory: string;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}>;

/** An environment the config parser accepts, pointed at a throwaway database. */
export const testEnvironment = (databaseUrl: string, mediaDirectory: string, authRateLimitPerMinute = 1_000_000) =>
  ({
    LOG_LEVEL: "fatal" as const,
    HOST: "127.0.0.1",
    PORT: 0,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_SIZE: 5,
    PUBLIC_WEB_URL: "http://localhost:3000",
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
    RECAPTCHA_SECRET_KEY: "",
    OAUTH_GOOGLE_CLIENT_ID: "",
    OAUTH_GOOGLE_CLIENT_SECRET: "",
    OAUTH_GITHUB_CLIENT_ID: "",
    OAUTH_GITHUB_CLIENT_SECRET: "",
    // Effectively off: the limiter keys on the client address and cannot tell
    // one test from the next. The throttling tests build their own app.
    AUTH_RATE_LIMIT_PER_MINUTE: authRateLimitPerMinute,
    MEDIA_DIR: mediaDirectory,
  }) as const;

/** Every table the tests write to, in an order that respects the foreign keys. */
const MUTABLE_TABLES = [
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
];

/**
 * Starts a Postgres container, migrates it, and builds the app against it.
 * `reset` empties the tables and moves the clock an hour on; `stop` takes
 * the container down.
 */
export const startHarness = async (): Promise<Harness> => {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const mediaDirectory = await mkdtemp(join(tmpdir(), "prism-media-"));

  const config = Config.fromEnvironment(testEnvironment(container.getConnectionUri(), mediaDirectory));
  const database = Database.open(config.database.url, config.database.poolSize);
  await Migrations.apply(database.db);

  const clock = Clock.mutable(TEST_START);
  const mailer = Mailer.memory();
  const app = await App.build({ config, database, overrides: { clock, mailer, hasher: fastHasher } });

  let epoch = TEST_START.getTime();

  return {
    app,
    database,
    clock,
    mailer,
    config,
    mediaDirectory,

    totpCodeFor: (secret) =>
      generateSync({
        secret,
        period: TotpService.PERIOD_SECONDS,
        digits: 6,
        epoch: Math.floor(clock.now().getTime() / 1000),
      }),

    reset: async () => {
      await database.sql.unsafe(`TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      epoch += 60 * 60 * 1000;
      clock.set(new Date(epoch));
      mailer.clear();
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
      const [reviewer] = await db
        .insert(users)
        .values({ email: Email.schema.parse(`reviewer-${seed.slug}-${index}@example.com`) })
        .returning({ id: users.id });
      if (reviewer === undefined) throw new Error("reviewer insert returned no row");

      await db.insert(productReviews).values({ productId: product.id, userId: reviewer.id, rating });
    }
  }
};
