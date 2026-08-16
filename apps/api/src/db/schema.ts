/**
 * The Drizzle schema is the query surface — it gives every column a compile-time
 * type. The DDL itself lives in hand-written SQL under `migrations/`, because
 * this database needs extensions, IMMUTABLE functions, generated columns built
 * on those functions, GIN indexes and a view. Generating that and then editing
 * it by hand would be two sources of truth; the SQL is the one.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  pgView,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres full-text search vectors. Drizzle has no built-in for these. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** Aggregates arrive from the driver as strings; the mapper turns them into numbers. */
const numericAsNumber = customType<{ data: number; driverData: string }>({
  dataType: () => "numeric",
  fromDriver: (value) => Number(value),
});

const primaryId = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const productFinish = pgEnum("product_finish", [
  "matte",
  "gloss",
  "iridescent",
  "fluorescent",
]);

/* ------------------------------------------------------------------ identity */

/** `user` is reserved in Postgres, hence `app_user`. */
export const users = pgTable(
  "app_user",
  {
    id: primaryId(),
    email: text("email").notNull(),
    /** Absent for accounts that only ever signed in with Google. */
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("customer"),
    /** Present once setup begins; confirmed only when `totpEnabledAt` is set. */
    totpSecret: text("totp_secret"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("app_user_email_key").on(table.email)],
);

export const oauthIdentities = pgTable(
  "oauth_identity",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** The provider's immutable user identifier — never the email. */
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("oauth_identity_provider_subject_key").on(
      table.provider,
      table.subject,
    ),
    index("oauth_identity_user_idx").on(table.userId),
  ],
);

/**
 * A session is both the revocation unit and the refresh-token family. The
 * access token carries its id as `sid`, so revoking one row invalidates the
 * access token and every refresh token descended from it at the same instant.
 */
export const sessions = pgTable(
  "session",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** `logout` | `token_reuse` | `password_reset` — why the session ended. */
    revokedReason: text("revoked_reason"),
    userAgent: text("user_agent").notNull().default(""),
    ipAddress: text("ip_address").notNull().default(""),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

/**
 * One row per issued refresh token. `usedAt` is what makes rotation
 * single-use: a token presented twice is a replay, and the whole session dies.
 */
export const refreshTokens = pgTable(
  "refresh_token",
  {
    id: primaryId(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. A database leak must not yield usable tokens. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("refresh_token_hash_key").on(table.tokenHash),
    index("refresh_token_session_idx").on(table.sessionId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_token",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("password_reset_token_hash_key").on(table.tokenHash),
    index("password_reset_token_user_idx").on(table.userId),
  ],
);

/* ----------------------------------------------------------------- catalog */

export const categories = pgTable(
  "category",
  {
    id: primaryId(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),
    position: integer("position").notNull().default(0),
    // Marked generated so Drizzle keeps it out of insert types — the DDL in
    // migration 0003 is what actually defines the expression.
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', name || ' ' || description)`),
  },
  (table) => [
    uniqueIndex("category_slug_key").on(table.slug),
    index("category_parent_idx").on(table.parentId),
  ],
);

export const brands = pgTable(
  "brand",
  {
    id: primaryId(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', name || ' ' || description)`),
  },
  (table) => [uniqueIndex("brand_slug_key").on(table.slug)],
);

export const products = pgTable(
  "product",
  {
    id: primaryId(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),

    /** The one stored fact about the color itself. */
    hex: text("hex").notNull(),
    finish: productFinish("finish").notNull(),

    /**
     * Derived from `hex` by IMMUTABLE SQL functions and materialized by
     * Postgres, so they can carry B-tree indexes for range faceting.
     *
     * Marked generated here so Drizzle omits them from insert types: writing
     * one is a compile error, and Postgres rejects it at runtime too.
     */
    hue: smallint("hue")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_hue(hex)`),
    saturation: smallint("saturation")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_saturation(hex)`),
    lightness: smallint("lightness")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_lightness(hex)`),

    /**
     * The color's own measurements, one per HSL channel. Generated like the
     * channels themselves, so the shop stores `hex` and `finish` and nothing
     * else about how a color measures. Imperial is derived in `@prism/shared`.
     */
    temperatureKelvin: smallint("temperature_kelvin")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_temperature(hex)`),
    reachCentimeters: integer("reach_centimeters")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_reach(hex, finish)`),
    weightGrams: integer("weight_grams")
      .notNull()
      .generatedAlwaysAs(sql`hex_to_weight(hex)`),

    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', description), 'C')`,
      ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("product_slug_key").on(table.slug),
    index("product_category_idx").on(table.categoryId),
    index("product_brand_idx").on(table.brandId),
    index("product_price_idx").on(table.priceCents),
    index("product_hue_idx").on(table.hue),
  ],
);

export const productImages = pgTable(
  "product_image",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Content-addressed filename on the media volume. */
    filename: text("filename").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index("product_image_product_idx").on(table.productId)],
);

export const productReviews = pgTable(
  "product_review",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("product_review_one_per_user_key").on(table.productId, table.userId),
    index("product_review_product_idx").on(table.productId),
  ],
);

/**
 * Ratings are aggregated here rather than stored on `product`, so a rating can
 * never disagree with the reviews it came from. Every catalog read goes
 * through this view. If it ever needs to be fast, `MATERIALIZED` is the only
 * word that changes — no application code moves.
 */
export const productListing = pgView("product_listing", {
  id: uuid("id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  stockQuantity: integer("stock_quantity").notNull(),
  hex: text("hex").notNull(),
  finish: productFinish("finish").notNull(),
  hue: smallint("hue").notNull(),
  saturation: smallint("saturation").notNull(),
  lightness: smallint("lightness").notNull(),
  temperatureKelvin: smallint("temperature_kelvin").notNull(),
  reachCentimeters: integer("reach_centimeters").notNull(),
  weightGrams: integer("weight_grams").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  searchVector: tsvector("search_vector").notNull(),
  brandSearchVector: tsvector("brand_search_vector").notNull(),
  categorySearchVector: tsvector("category_search_vector").notNull(),
  brandId: uuid("brand_id").notNull(),
  brandSlug: text("brand_slug").notNull(),
  brandName: text("brand_name").notNull(),
  categoryId: uuid("category_id").notNull(),
  categorySlug: text("category_slug").notNull(),
  categoryName: text("category_name").notNull(),
  ratingAverage: numericAsNumber("rating_average").notNull(),
  ratingCount: integer("rating_count").notNull(),
}).existing();

export const schemaMigrations = pgTable("schema_migration", {
  name: text("name").primaryKey(),
  appliedAt: createdAt(),
});

export const schema = {
  users,
  oauthIdentities,
  sessions,
  refreshTokens,
  passwordResetTokens,
  categories,
  brands,
  products,
  productImages,
  productReviews,
  productListing,
  schemaMigrations,
};

/** Re-exported so query files can build raw fragments without another import. */
export { sql };
