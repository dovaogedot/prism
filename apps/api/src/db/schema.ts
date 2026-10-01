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
import {
  OrderStatus,
  ShippingMethod,
  type Email,
  type OAuthProvider,
  type OrderId,
  type OrderNumber,
  type ProductId,
  type Slug,
  type UserId,
} from "@prism/shared";
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
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
import type { BrandId, CartId, CategoryId, PaymentId, SessionId } from "./ids.ts";

/** Postgres full-text search vectors, which drizzle has no built-in for. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** Raw bytes, which drizzle has no built-in for. Every encrypted column is one. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** A SQL list of string literals, for a CHECK over a closed set of names. */
const literals = (names: readonly string[]) => sql.raw(names.map((name) => `'${name}'`).join(", "));

/** What a payment row records: money taken, or money given back. */
export type PaymentKind = "charge" | "refund";

/** Where a payment row stands at the provider. */
export type PaymentStatus = "pending" | "succeeded" | "failed" | "canceled";

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

/* ----------------------------------------------------------------- commerce */

/**
 * A cart belongs to a user or to a guest's cookie, never both. A guest cart
 * expires; a user cart lives until checkout empties it.
 */
export const carts = pgTable(
  "cart",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<CartId>(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    /** SHA-256 of the guest cookie; the cookie itself is never stored. */
    tokenHash: text("token_hash").$type<Digest>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null for a user cart. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("cart_user_key").on(table.userId),
    uniqueIndex("cart_token_hash_key").on(table.tokenHash),
    // The cleanup scans guest carts by expiry.
    index("cart_guest_expiry_idx").on(table.expiresAt).where(sql`${table.userId} IS NULL`),
    check("cart_one_owner", sql`(${table.userId} IS NULL) <> (${table.tokenHash} IS NULL)`),
    check("cart_guest_expires", sql`${table.userId} IS NOT NULL OR ${table.expiresAt} IS NOT NULL`),
  ],
);

/** One product in one cart. Prices are read from the product, never stored here. */
export const cartItems = pgTable(
  "cart_item",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" })
      .$type<CartId>(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" })
      .$type<ProductId>(),
    quantity: integer("quantity").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.productId] }),
    index("cart_item_product_idx").on(table.productId),
    check("cart_item_quantity_range", sql`${table.quantity} BETWEEN 1 AND 99`),
  ],
);

/**
 * A placed order. The contact, the address and a guest's access key are
 * sealed by the API before they are written, so these columns hold
 * ciphertext. Status, dates and amounts stay plain: lists filter and sort
 * on them, and they identify nobody.
 */
export const orders = pgTable(
  "customer_order",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<OrderId>(),
    /** What the customer quotes. */
    number: integer("number").notNull().generatedAlwaysAsIdentity({ startWith: 100001 }).$type<OrderNumber>(),
    /** Null for a guest's order. An account with orders cannot be deleted. */
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .$type<UserId>(),
    /** The cart this order was placed from, emptied once the payment succeeds. */
    cartId: uuid("cart_id")
      .references(() => carts.id, { onDelete: "set null" })
      .$type<CartId>(),
    status: text("status").notNull().$type<OrderStatus>(),
    shippingMethod: text("shipping_method").notNull().$type<ShippingMethod>(),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Sealed: name, email and phone. */
    contact: bytea("contact").notNull(),
    /** Sealed. */
    shippingAddress: bytea("shipping_address").notNull(),
    /** Sealed, not hashed: the emails sent later carry it in their links. Guest orders only. */
    accessKey: bytea("access_key"),
    trackingNumber: text("tracking_number"),
    /** When the payment came back to the customer; set once. */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    /** When an unpaid order expires and gives its stock back. */
    paymentDueAt: timestamp("payment_due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_order_number_key").on(table.number),
    index("customer_order_user_created_idx").on(table.userId, table.createdAt.desc()),
    // Housekeeping finds orders by status and how long they have had it.
    index("customer_order_status_changed_idx").on(table.status, table.statusChangedAt),
    check("customer_order_status_known", sql`${table.status} IN (${literals(OrderStatus.NAMES)})`),
    check("customer_order_shipping_known", sql`${table.shippingMethod} IN (${literals(ShippingMethod.NAMES)})`),
    check(
      "customer_order_money_not_negative",
      sql`${table.subtotalCents} >= 0 AND ${table.shippingCents} >= 0 AND ${table.totalCents} >= 0`,
    ),
    check("customer_order_total_adds_up", sql`${table.totalCents} = ${table.subtotalCents} + ${table.shippingCents}`),
    check("customer_order_has_owner", sql`${table.userId} IS NOT NULL OR ${table.accessKey} IS NOT NULL`),
    check(
      "customer_order_tracking_when_shipped",
      sql`(${table.trackingNumber} IS NOT NULL) = (${table.status} IN ('shipped', 'delivered'))`,
    ),
  ],
);

/**
 * One product of an order, as it was sold. The name, slug and price are a
 * snapshot, so the order stays true when the catalog changes.
 */
export const orderLines = pgTable(
  "order_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" })
      .$type<OrderId>(),
    /** Null once the product has left the catalog. */
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "set null" })
      .$type<ProductId>(),
    productName: text("product_name").notNull(),
    productSlug: text("product_slug").notNull().$type<Slug>(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (table) => [
    uniqueIndex("order_line_product_key").on(table.orderId, table.productId),
    index("order_line_product_idx").on(table.productId),
    check("order_line_quantity_positive", sql`${table.quantity} >= 1`),
    check("order_line_price_not_negative", sql`${table.unitPriceCents} >= 0`),
    check("order_line_total_adds_up", sql`${table.lineTotalCents} = ${table.unitPriceCents} * ${table.quantity}`),
  ],
);

/** An order's timeline: one row per status it reached. */
export const orderEvents = pgTable(
  "order_event",
  {
    /** Increasing, so two events with the same timestamp keep the order they were written in. */
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" })
      .$type<OrderId>(),
    status: text("status").notNull().$type<OrderStatus>(),
    /** Null when the status says it all. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_event_order_created_idx").on(table.orderId, table.createdAt),
    check("order_event_status_known", sql`${table.status} IN (${literals(OrderStatus.NAMES)})`),
  ],
);

/**
 * Money moving for an order: one charge, and at most one refund. The
 * provider's reference and the card summary are sealed.
 */
export const payments = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<PaymentId>(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" })
      .$type<OrderId>(),
    kind: text("kind").notNull().$type<PaymentKind>(),
    status: text("status").notNull().$type<PaymentStatus>(),
    amountCents: integer("amount_cents").notNull(),
    provider: text("provider").notNull().default("stripe"),
    /** Sealed intent or refund id; null until the provider has answered. */
    reference: bytea("reference"),
    /** Sealed card brand and last four digits, failure code and provider message. */
    details: bytea("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_order_kind_key").on(table.orderId, table.kind),
    check("payment_kind_known", sql`${table.kind} IN ('charge', 'refund')`),
    check("payment_status_known", sql`${table.status} IN ('pending', 'succeeded', 'failed', 'canceled')`),
    check("payment_amount_not_negative", sql`${table.amountCents} >= 0`),
  ],
);

/**
 * Messages waiting to be published. A module writes one in the same
 * transaction as the change it announces, so a message exists exactly when
 * its change committed; the relay publishes it and stamps `published_at`.
 */
export const outboxMessages = pgTable(
  "outbox_message",
  {
    /** Also the message id a consumer sees. */
    id: uuid("id").primaryKey().defaultRandom(),
    exchange: text("exchange").notNull(),
    routingKey: text("routing_key").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [index("outbox_message_unpublished_idx").on(table.createdAt).where(sql`${table.publishedAt} IS NULL`)],
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
  carts,
  cartItems,
  orders,
  orderLines,
  orderEvents,
  payments,
  outboxMessages,
  productRelations,
  productImageRelations,
  productPropertyRelations,
  productReviewRelations,
};
