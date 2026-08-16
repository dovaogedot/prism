/**
 * Integration test harness.
 *
 * Starts a real Postgres in a container, applies the real migrations, and
 * builds the real application — same `buildApp` the container runs. Only the
 * pieces that would reach the outside world are substituted: the clock (so
 * expiry is controllable), the mailer (so messages can be asserted on), and
 * the hasher (so argon2 does not dominate the runtime).
 *
 * Requests go through `app.inject`, which exercises the full Fastify pipeline
 * — routing, schema validation, guards, serialization — without a socket.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { generateSync } from "otplib";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { toConfig, type Config } from "../../src/config.ts";
import { createDatabase, type DatabaseHandle } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { mutableClock, type MutableClock } from "../../src/platform/clock.ts";
import { createMemoryMailer } from "../../src/platform/mailer.ts";
import type { MemoryMailer } from "../../src/platform/mailer.ts";
import type { Hasher } from "../../src/platform/hasher.ts";

export const TEST_START = new Date("2026-08-07T12:00:00.000Z");

/** Matches `PERIOD_SECONDS` in the TOTP adapter. */
const TOTP_PERIOD_SECONDS = 30;

/**
 * Argon2 at production parameters costs ~50 ms per call, which across a full
 * suite is minutes of nothing useful. This keeps the *shape* — same hash on
 * the same input, verification that can fail — at no cost.
 */
const fastHasher: Hasher = {
  hash: async (plaintext) => `fake:${Buffer.from(plaintext).toString("base64")}`,
  verify: async (storedHash, plaintext) =>
    storedHash === `fake:${Buffer.from(plaintext).toString("base64")}`,
  fakeVerify: async () => undefined,
};

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

export const testEnvironment = (
  databaseUrl: string,
  mediaDirectory: string,
  authRateLimitPerMinute = 1_000_000,
) => ({
  NODE_ENV: "test" as const,
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
  CAPTCHA_MODE: "test" as const,
  RECAPTCHA_SECRET_KEY: "",
  OAUTH_MODE: "mock" as const,
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  // Effectively off by default. The limiter keys on the client address and
  // has no idea a new test started, so a realiztic budget would exhaust
  // itself a few tests in and turn every later assertion into a 429. The
  // tests that exercise throttling build their own app with a low budget.
  AUTH_RATE_LIMIT_PER_MINUTE: authRateLimitPerMinute,
  MEDIA_DIR: mediaDirectory,
  MEDIA_MAX_BYTES: 2 * 1024 * 1024,
  CATEGORY_CACHE_TTL_SECONDS: 300,
  FACET_CACHE_TTL_SECONDS: 60,
  PRODUCT_CACHE_TTL_SECONDS: 60,
});

/** Every table the tests write to, in an order that respects the FKs. */
const MUTABLE_TABLES = [
  "refresh_token",
  "password_reset_token",
  "session",
  "oauth_identity",
  "product_review",
  "product_image",
  "product",
  "brand",
  "category",
  "app_user",
];

export const startHarness = async (): Promise<Harness> => {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:18-alpine",
  ).start();

  const databaseUrl = container.getConnectionUri();
  const mediaDirectory = await mkdtemp(join(tmpdir(), "hue-media-"));

  const migrator = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await runMigrations(migrator);
  await migrator.end();

  const config = toConfig(testEnvironment(databaseUrl, mediaDirectory));
  const database = createDatabase(config.database.url, config.database.poolSize);

  const clock = mutableClock(TEST_START);
  const mailer = createMemoryMailer();

  const app = await buildApp({
    config,
    database,
    overrides: { clock, mailer, hasher: fastHasher },
  });

  // Each reset starts an hour after the last, so cached responses from an
  // earlier test are always past their TTL. Resetting to a fixed instant
  // would leave them live and hand the next test stale data.
  let epoch = TEST_START.getTime();

  return {
    app,
    database,
    clock,
    mailer,
    config,
    mediaDirectory,

    // Truncate rather than re-migrate: it is far quicker, and RESTART IDENTITY
    // plus CASCADE leaves the schema exactly as the migrations built it.
    totpCodeFor: (secret) =>
      generateSync({
        secret,
        period: TOTP_PERIOD_SECONDS,
        digits: 6,
        epoch: Math.floor(clock.now().getTime() / 1000),
      }),

    reset: async () => {
      await database.sql.unsafe(
        `TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
      );
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

/* ----------------------------------------------------------------- helpers */

export const jsonOf = (response: { body: string }): Record<string, unknown> =>
  JSON.parse(response.body);

/** Reads a Set-Cookie value by name from an inject response. */
export const cookieValue = (
  response: { cookies: readonly unknown[] },
  name: string,
): string => {
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

export const VALID_PASSWORD = "correct horse battery staple";

export const registerUser = async (
  harness: Harness,
  email: string,
  password: string = VALID_PASSWORD,
) => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, captchaToken: "test-token" },
  });

  const body = jsonOf(response);

  return {
    response,
    accessToken: typeof body["accessToken"] === "string" ? body["accessToken"] : "",
    refreshToken: cookieValue(response, "hue_refresh"),
  };
};

/** Seeds a minimal catalog: one category, one brand, and the given colors. */
export const seedCatalog = async (
  harness: Harness,
  colors: readonly Readonly<{
    slug: string;
    name: string;
    hex: string;
    priceCents: number;
    finish?: string;
  }>[],
): Promise<void> => {
  const { sql } = harness.database;

  await sql`INSERT INTO category (slug, name) VALUES ('reds', 'Reds')`;
  await sql`INSERT INTO brand (slug, name) VALUES ('chroma-labs', 'Chroma Labs')`;

  for (const color of colors) {
    await sql`
      INSERT INTO product (
        slug, name, description, price_cents, stock_quantity,
        category_id, brand_id, hex, finish
      )
      SELECT ${color.slug}, ${color.name}, ${`${color.name} description`},
             ${color.priceCents}, 10, c.id, b.id, ${color.hex},
             ${color.finish ?? "matte"}::product_finish
      FROM category c, brand b
      WHERE c.slug = 'reds' AND b.slug = 'chroma-labs'
    `;
  }
};
