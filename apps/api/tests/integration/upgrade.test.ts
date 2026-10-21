/**
 * The upgrade of a database built before the identity columns were sealed.
 * Each case builds that database the way it was built then, with drizzle's
 * own migrator and only the migrations of that time, fills it with plain
 * text, and runs today's migrations and upgrade step over it.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Contact, Email, ShippingAddress } from "@prism/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { generateSync } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "../../src/app.ts";
import { Config } from "../../src/config.ts";
import { Database, type DatabaseHandle } from "../../src/db/client.ts";
import { Migrations } from "../../src/db/migrate.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { AuthRepository } from "../../src/modules/auth/repository.ts";
import { AuditLog } from "../../src/modules/staff/audit.ts";
import { AddressVerifier } from "../../src/platform/address-verifier.ts";
import { FieldCipher } from "../../src/platform/cipher.ts";
import { Clock } from "../../src/platform/clock.ts";
import { Mailer } from "../../src/platform/mailer.ts";
import { IdentityProvider, MockAuthorizationCode, RedirectUri } from "../../src/platform/oauth.ts";
import { PaymentGateway } from "../../src/platform/payment-gateway.ts";
import { MessageQueue } from "../../src/platform/queue.ts";
import { TotpService } from "../../src/platform/totp.ts";
import { fastHasher, testEnvironment, TEST_START, VALID_PASSWORD } from "../support/harness.ts";

/** The plain text a part 2 database held, which must not survive the upgrade anywhere. */
const PLAIN = {
  email: "upgraded.shopper@example.com",
  oauthEmail: "linked.shopper@example.com",
  userAgent: "Mozilla/5.0 (UpgradeTest) Gecko/20100101",
  ip: "203.0.113.77",
} as const;

let container: StartedPostgreSqlContainer;
let migrationsBefore: string;
let media: string;

/** A config for the database `name` in the shared container. */
const configFor = (name: string): Config => {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return Config.fromEnvironment(testEnvironment(url.toString(), media));
};

/** A fresh database built by the migrations of part 2 only, through drizzle's migrator, as the server's was. */
const part2Database = async (name: string): Promise<{ config: Config; database: DatabaseHandle }> => {
  const admin = Database.open(container.getConnectionUri(), 1);
  await admin.sql.unsafe(`CREATE DATABASE ${name}`);
  await admin.close();

  const config = configFor(name);
  const database = Database.open(config.database.url, 2);
  await migrate(database.db, { migrationsFolder: migrationsBefore });

  return { config, database };
};

/** What the part 2 database holds, and what a test needs to find it again. */
type Planted = Readonly<{ userId: string; totpSecret: string; subject: string; orderId: string; placedAt: Date }>;

/** Fills a part 2 database with an account, its OAuth identity and session, an order and a review. */
const plant = async (database: DatabaseHandle, config: Config): Promise<Planted> => {
  const cipher = FieldCipher.create(config.encryptionKey);
  const totpSecret = TotpService.create(Clock.mutable(TEST_START)).generateSecret();
  const passwordHash = await fastHasher.hash(VALID_PASSWORD);

  const [user] = await database.sql`
    INSERT INTO app_user (email, password_hash, totp_secret, totp_enabled_at)
    VALUES (${PLAIN.email}, ${passwordHash}, ${totpSecret}, now()) RETURNING id`;
  const [linked] = await database.sql`INSERT INTO app_user (email) VALUES (${PLAIN.oauthEmail}) RETURNING id`;

  // The subject the mock provider reports for this address, as a real sign-in would have stored it.
  const provider = IdentityProvider.mock("github", config.tokens.secret);
  const email = Email.schema.parse(PLAIN.oauthEmail);
  const profile = await provider.exchange(
    MockAuthorizationCode.issue("github", email, config.tokens.secret),
    RedirectUri.schema.parse("http://localhost:3000/callback"),
  );
  if (profile.isErr()) throw new Error("the mock provider refused its own code");

  await database.sql`
    INSERT INTO oauth_identity (user_id, provider, subject) VALUES (${String(linked?.["id"])}, 'github', ${profile.value.subject})`;
  await database.sql`
    INSERT INTO session (user_id, expires_at, user_agent, ip_address)
    VALUES (${String(user?.["id"])}, now() + interval '7 days', ${PLAIN.userAgent}, ${PLAIN.ip})`;
  await database.sql`
    INSERT INTO session (user_id, expires_at) VALUES (${String(linked?.["id"])}, now() + interval '7 days')`;

  const [category] = await database.sql`INSERT INTO category (slug, name) VALUES ('lamps', 'Lamps') RETURNING id`;
  const [brand] = await database.sql`INSERT INTO brand (slug, name) VALUES ('acme', 'Acme') RETURNING id`;
  const [product] = await database.sql`
    INSERT INTO product (slug, name, description, price_cents, stock, category_id, brand_id, weight_grams, width_mm, height_mm, depth_mm)
    VALUES ('desk-lamp', 'Desk lamp', 'A lamp.', 2500, 5, ${String(category?.["id"])}, ${String(brand?.["id"])}, 900, 200, 400, 200)
    RETURNING id`;
  await database.sql`
    INSERT INTO product_review (product_id, user_id, rating) VALUES (${String(product?.["id"])}, ${String(user?.["id"])}, 4)`;

  // Friday 16 October 2026 in Tallinn: standard delivery counts to Tuesday and Thursday.
  const placedAt = new Date("2026-10-16T10:00:00Z");
  const contact = Contact.schema.parse({ fullName: "Mari Maasikas", email: PLAIN.email, phone: "+372 5123 4567" });
  const address = ShippingAddress.schema.parse({ line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" });
  const [order] = await database.sql`
    INSERT INTO customer_order
      (user_id, status, shipping_method, subtotal_cents, shipping_cents, total_cents, contact, shipping_address,
       tracking_number, payment_due_at, created_at, status_changed_at)
    VALUES (${String(user?.["id"])}, 'delivered', 'standard', 2500, 490, 2990, ${cipher.seal(contact)}, ${cipher.seal(address)},
            'PR000000001EE', ${placedAt.toISOString()}, ${placedAt.toISOString()}, ${placedAt.toISOString()})
    RETURNING id`;

  return {
    userId: String(user?.["id"]),
    totpSecret,
    subject: profile.value.subject,
    orderId: String(order?.["id"]),
    placedAt,
  };
};

/** The application over `database`, with everything that would leave the process faked. */
const appOver = async (config: Config, database: DatabaseHandle) =>
  App.build({
    config,
    database,
    overrides: {
      clock: Clock.mutable(TEST_START),
      mailer: Mailer.memory(),
      hasher: fastHasher,
      queue: MessageQueue.memory(Topology.declarations()),
      gateway: PaymentGateway.fake(),
      addressVerifier: AddressVerifier.fake(),
    },
  });

/** The files under the database's own directory that contain `text`, one per line. */
const filesHolding = async (database: DatabaseHandle, text: string): Promise<string> => {
  const [location] = await database.sql`
    SELECT current_setting('data_directory') || '/base/' || oid AS path FROM pg_database WHERE datname = current_database()`;
  const found = await container.exec(["grep", "-r", "-l", "-F", text, String(location?.["path"])]);

  return found.output.trim();
};

const columnsOf = async (database: DatabaseHandle, table: string): Promise<readonly string[]> =>
  (
    await database.sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = ${table} ORDER BY column_name`
  ).map((row) => row.column_name);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  media = await mkdtemp(join(tmpdir(), "prism-upgrade-media-"));

  // The migrations folder as it stood before the identity columns were sealed.
  migrationsBefore = await mkdtemp(join(tmpdir(), "prism-part2-migrations-"));
  await cp(Migrations.folder, migrationsBefore, { recursive: true });
  const journalPath = join(migrationsBefore, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag === "0000_initial" || entry.tag === "0001_commerce");
  await writeFile(journalPath, JSON.stringify(journal));
});

afterAll(async () => {
  await container.stop();
  await rm(migrationsBefore, { recursive: true, force: true });
  await rm(media, { recursive: true, force: true });
});

describe("upgrading a part 2 database", () => {
  let config: Config;
  let database: DatabaseHandle;
  let planted: Planted;
  /** Where the email was on disk before the upgrade, which shows the search below can find it. */
  let beforeUpgrade: string;

  beforeAll(async () => {
    ({ config, database } = await part2Database("upgraded"));
    planted = await plant(database, config);

    // Postgres writes pages out at a checkpoint; forcing one puts the plain text on disk.
    await database.sql`CHECKPOINT`;
    beforeUpgrade = await filesHolding(database, PLAIN.email);

    await Migrations.apply(database.db, FieldCipher.create(config.encryptionKey));
    await database.sql`CHECKPOINT`;
  });

  afterAll(async () => {
    await database.close();
  });

  it("drops the legacy columns and finishes the constraints", async () => {
    expect(await columnsOf(database, "app_user")).not.toContain("legacy_email");
    expect(await columnsOf(database, "app_user")).not.toContain("legacy_totp_secret");
    expect(await columnsOf(database, "oauth_identity")).not.toContain("legacy_subject");
    expect(await columnsOf(database, "session")).not.toContain("legacy_user_agent");
    expect(await columnsOf(database, "session")).not.toContain("legacy_ip_address");

    await expect(database.sql`INSERT INTO app_user (email_index) VALUES ('\\x01'::bytea)`).rejects.toMatchObject({
      column_name: "email",
    });
    await expect(database.sql`UPDATE app_user SET totp_secret = NULL WHERE id = ${planted.userId}`).rejects.toMatchObject({
      constraint_name: "app_user_totp_needs_secret",
    });
  });

  it("lets the account sign in with the same email, password and authenticator", async () => {
    const { app } = await appOver(config, database);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: PLAIN.email, password: VALID_PASSWORD },
    });
    const challenge = JSON.parse(login.body) as { status: string; challengeToken: string };
    expect(challenge.status).toBe("two_factor_required");

    const code = generateSync({
      secret: planted.totpSecret,
      period: TotpService.PERIOD_SECONDS,
      digits: 6,
      epoch: Math.floor(TEST_START.getTime() / 1000),
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/2fa",
      payload: { challengeToken: challenge.challengeToken, code },
    });

    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toMatchObject({ status: "authenticated", grant: { user: { email: PLAIN.email } } });
    await app.close();
  });

  it("still finds the OAuth identity by its subject", async () => {
    const cipher = FieldCipher.create(config.encryptionKey);
    const repository = AuthRepository.create(database.db, cipher, AuditLog.create(database.db, cipher));
    const found = await repository.findUserByOAuthIdentity("github", planted.subject as never);

    expect(found?.email).toBe(PLAIN.oauthEmail);
  });

  it("gives the order its method name and delivery dates, and publishes the review", async () => {
    const [order] = await database.sql`
      SELECT shipping_method_name, estimated_delivery_from::text AS "from", estimated_delivery_to::text AS "to"
      FROM customer_order WHERE id = ${planted.orderId}`;
    const [review] = await database.sql`SELECT status, author_name FROM product_review`;

    expect(order).toEqual({ shipping_method_name: "Standard", from: "2026-10-20", to: "2026-10-22" });
    expect(review).toEqual({ status: "approved", author_name: "Prism customer" });
  });

  it("gives the order's email the index staff search by", async () => {
    const cipher = FieldCipher.create(config.encryptionKey);
    const rows = await database.sql`
      SELECT id FROM customer_order WHERE email_index = ${cipher.index("order-email", Email.schema.parse(PLAIN.email))}`;

    expect(rows.map((row) => row["id"])).toEqual([planted.orderId]);
  });

  it("keeps none of the plain text in the rows", async () => {
    const rows = await database.sql`
      SELECT u.email, u.totp_secret, i.subject, s.user_agent, s.ip_address
      FROM app_user u
      LEFT JOIN oauth_identity i ON i.user_id = u.id
      LEFT JOIN session s ON s.user_id = u.id`;
    const stored = rows
      .flatMap((row) => Object.values(row))
      .filter((value): value is Uint8Array => value instanceof Uint8Array)
      .map((value) => Buffer.from(value).toString("latin1"))
      .join("\n");

    for (const plaintext of [...Object.values(PLAIN), planted.totpSecret, planted.subject]) {
      expect(stored, plaintext).not.toContain(plaintext);
    }
  });

  it("keeps none of the plain text in the database's files on disk", async () => {
    expect(beforeUpgrade).not.toBe("");

    for (const plaintext of [...Object.values(PLAIN), planted.totpSecret, planted.subject]) {
      expect(await filesHolding(database, plaintext), plaintext).toBe("");
    }
  });

  it("does nothing when run again", async () => {
    await Migrations.apply(database.db, FieldCipher.create(config.encryptionKey));

    const [account] = await database.sql`SELECT count(*)::int AS n FROM app_user`;
    expect(account?.["n"]).toBe(2);
  });
});

describe("an upgrade that fails halfway", () => {
  let config: Config;
  let database: DatabaseHandle;

  beforeAll(async () => {
    ({ config, database } = await part2Database("interrupted"));
    await plant(database, config);
  });

  afterAll(async () => {
    await database.close();
  });

  it("leaves the part 2 schema and data as they were", async () => {
    const real = FieldCipher.create(config.encryptionKey);
    let sealed = 0;
    const failing: FieldCipher = {
      ...real,
      seal: (value) => {
        sealed += 1;
        if (sealed > 3) throw new Error("the disk filled up");
        return real.seal(value);
      },
    };

    await expect(Migrations.apply(database.db, failing)).rejects.toThrow("the disk filled up");

    expect(await columnsOf(database, "app_user")).toEqual([
      "created_at",
      "email",
      "id",
      "password_hash",
      "totp_enabled_at",
      "totp_secret",
    ]);
    expect(await database.sql`SELECT email FROM app_user ORDER BY email`).toEqual([
      { email: PLAIN.oauthEmail },
      { email: PLAIN.email },
    ]);
    expect(await database.sql`SELECT to_regclass('shipping_method') AS present`).toEqual([{ present: null }]);
    expect(await database.sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).toEqual([{ n: 2 }]);
  });

  it("upgrades on the next run", async () => {
    await Migrations.apply(database.db, FieldCipher.create(config.encryptionKey));

    expect(await columnsOf(database, "app_user")).not.toContain("legacy_email");
    expect(await database.sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).toEqual([{ n: 3 }]);
  });
});
