/**
 * The database schema, and the one source the DDL is generated from.
 *
 * `drizzle-kit generate` turns this file into the SQL under `drizzle/`, and
 * the migrator applies that SQL at start. Tables, enums and relations are
 * top-level exports because drizzle-kit reads the module's exports.
 *
 * Nothing here knows what the shop sells. A product is a name, a price,
 * stock, a category, a brand, its measurements and a bag of named
 * properties; every filter is derived from those rows.
 */

import { relations, sql } from "drizzle-orm";
import type { Email, OAuthProvider, ProductId, Slug, UserId } from "@prism/shared";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PasswordHash } from "../platform/hasher.ts";
import type { ProviderSubject } from "../platform/oauth.ts";
import type { Digest } from "../platform/tokens.ts";
import type { TotpSecret } from "../platform/totp.ts";
import type { BrandId, CategoryId, SessionId } from "./ids.ts";

/** Postgres full-text search vectors, which drizzle has no built-in for. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/* ----------------------------------------------------------------- identity */

/** Accounts. `user` is reserved in Postgres, hence `app_user`. */
export const users = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<UserId>(),
    email: text("email").notNull().$type<Email>(),
    /** Null for an account that only ever signed in through a provider. */
    passwordHash: text("password_hash").$type<PasswordHash>(),
    /** Present once setup begins; confirmed only when `totpEnabledAt` is set. */
    totpSecret: text("totp_secret").$type<TotpSecret>(),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_user_email_key").on(table.email),
    check("app_user_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check("app_user_email_shape", sql`${table.email} LIKE '%_@_%'`),
    check(
      "app_user_totp_needs_secret",
      sql`${table.totpEnabledAt} IS NULL OR ${table.totpSecret} IS NOT NULL`,
    ),
  ],
);

/** One provider account linked to one user. A user may have several. */
export const oauthIdentities = pgTable(
  "oauth_identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    provider: text("provider").notNull().$type<OAuthProvider>(),
    /** The provider's immutable user identifier, never the email. */
    subject: text("subject").notNull().$type<ProviderSubject>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_identity_provider_subject_key").on(table.provider, table.subject),
    index("oauth_identity_user_idx").on(table.userId),
  ],
);

/** Why a session ended, so an investigation can tell logout from attack. */
export type RevocationReason = "logout" | "token_reuse" | "password_reset";

/**
 * A session is both the revocation unit and the refresh-token family. The
 * access token carries its id as `sid`, so revoking one row invalidates the
 * access token and every refresh token descended from it at the same instant.
 */
export const sessions = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<SessionId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Why the session ended; null while it is live. */
    revokedReason: text("revoked_reason").$type<RevocationReason>(),
    userAgent: text("user_agent").notNull().default(""),
    ipAddress: text("ip_address").notNull().default(""),
  },
  (table) => [
    index("session_user_idx").on(table.userId),
    // The guard's hot path: is this session live right now?
    index("session_live_idx").on(table.id).where(sql`${table.revokedAt} IS NULL`),
    check(
      "session_revocation_has_reason",
      sql`(${table.revokedAt} IS NULL) = (${table.revokedReason} IS NULL)`,
    ),
  ],
);

/**
 * One row per issued refresh token. `usedAt` is what makes rotation
 * single-use: a token presented twice is a replay, and the whole session dies.
 */
export const refreshTokens = pgTable(
  "refresh_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" })
      .$type<SessionId>(),
    /** SHA-256 of the token. A database leak must not yield usable tokens. */
    tokenHash: text("token_hash").notNull().$type<Digest>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("refresh_token_hash_key").on(table.tokenHash),
    index("refresh_token_session_idx").on(table.sessionId),
  ],
);

/** Outstanding reset links, stored as digests and usable once. */
export const passwordResetTokens = pgTable(
  "password_reset_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    tokenHash: text("token_hash").notNull().$type<Digest>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("password_reset_token_hash_key").on(table.tokenHash),
    index("password_reset_token_user_idx").on(table.userId),
  ],
);

/* ------------------------------------------------------------------ catalog */

/** Where a product is filed. */
export const categories = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<CategoryId>(),
    slug: text("slug").notNull().$type<Slug>(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("category_slug_key").on(table.slug)],
);

/** Who makes a product. */
export const brands = pgTable(
  "brand",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<BrandId>(),
    slug: text("slug").notNull().$type<Slug>(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("brand_slug_key").on(table.slug)],
);

/** Anything the shop sells. Measurements are metric; the API derives imperial. */
export const products = pgTable(
  "product",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<ProductId>(),
    slug: text("slug").notNull().$type<Slug>(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(),
    stock: integer("stock").notNull().default(0),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" })
      .$type<CategoryId>(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" })
      .$type<BrandId>(),
    weightGrams: integer("weight_grams").notNull(),
    widthMm: integer("width_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    depthMm: integer("depth_mm").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** What full-text search matches: the name weighted above the description. */
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', description), 'C')`,
      ),
  },
  (table) => [
    uniqueIndex("product_slug_key").on(table.slug),
    index("product_category_idx").on(table.categoryId),
    index("product_brand_idx").on(table.brandId),
    index("product_price_idx").on(table.priceCents),
    index("product_search_idx").using("gin", table.search),
    check("product_price_not_negative", sql`${table.priceCents} >= 0`),
    check("product_stock_not_negative", sql`${table.stock} >= 0`),
    check(
      "product_measures_positive",
      sql`${table.weightGrams} > 0 AND ${table.widthMm} > 0 AND ${table.heightMm} > 0 AND ${table.depthMm} > 0`,
    ),
  ],
);

/**
 * One named fact about one product. The names are data: whatever the rows
 * say a product has is what the facets offer.
 */
export const productProperties = pgTable(
  "product_property",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" })
      .$type<ProductId>(),
    name: text("name").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.name] }),
    index("product_property_name_value_idx").on(table.name, table.value),
  ],
);

/** The pictures of a product, in the order they are shown. */
export const productImages = pgTable(
  "product_image",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" })
      .$type<ProductId>(),
    /** The file's name under the media directory. */
    file: text("file").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (table) => [uniqueIndex("product_image_position_key").on(table.productId, table.position)],
);

/** What shoppers said. One review per person per product. */
export const productReviews = pgTable(
  "product_review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" })
      .$type<ProductId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    /** Whole stars, 1 to 5. */
    rating: smallint("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_review_one_per_user_key").on(table.productId, table.userId),
    index("product_review_product_idx").on(table.productId),
    check("product_review_rating_range", sql`${table.rating} BETWEEN 1 AND 5`),
  ],
);

/* ---------------------------------------------------------------- relations */

/** What `db.query.products` can join in one call. */
export const productRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  images: many(productImages),
  properties: many(productProperties),
  reviews: many(productReviews),
}));

export const productImageRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const productPropertyRelations = relations(productProperties, ({ one }) => ({
  product: one(products, { fields: [productProperties.productId], references: [products.id] }),
}));

export const productReviewRelations = relations(productReviews, ({ one }) => ({
  product: one(products, { fields: [productReviews.productId], references: [products.id] }),
}));

/** Every table and relation, as the query builder is typed against. */
export const schema = {
  users,
  oauthIdentities,
  sessions,
  refreshTokens,
  passwordResetTokens,
  categories,
  brands,
  products,
  productProperties,
  productImages,
  productReviews,
  productRelations,
  productImageRelations,
  productPropertyRelations,
  productReviewRelations,
};
