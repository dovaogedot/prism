/**
 * The Drizzle schema is the query surface — it gives every column a compile-time
 * type. The DDL itself lives in hand-written SQL under `migrations/`, because
 * this database needs extensions, IMMUTABLE functions, generated columns built
 * on those functions, GIN indexes and a view. Generating that and then editing
 * it by hand would be two sources of truth; the SQL is the one.
 */

import { sql } from "drizzle-orm";
import {
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

/** What an account is allowed to reach. */
export const userRole = pgEnum("user_role", ["customer", "admin"]);
/** The discriminant of the product union; also the slug of its category. */
export const productKind = pgEnum("product_kind", [
  "color",
  "finisher",
  "shifter",
]);
/** Which way round the wheel a shifter turns. */
export const shiftDirection = pgEnum("shift_direction", ["cw", "ccw"]);

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

/** One provider account linked to one user. A user may have several. */
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

/** Outstanding reset links, stored as digests and usable once. */
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

/** The pigment foundries products are sold under. */
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

/**
 * What every product has, whichever of the three it is.
 *
 * `kind` is the discriminant and nothing else here varies by it, so there is no
 * nullable column and no CHECK deciding which ones apply. What varies lives in
 * `colors`, `finishers` and `shifters`, one row each, keyed back to this one.
 */
export const products = pgTable(
  "product",
  {
    id: primaryId(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    /** Which of the three this is, and which sub-table therefore holds its rest. */
    kind: productKind("kind").notNull(),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', description), 'C')`,
      ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("product_slug_key").on(table.slug),
    index("product_brand_idx").on(table.brandId),
    index("product_price_idx").on(table.priceCents),
    index("product_kind_idx").on(table.kind),
  ],
);

/**
 * A color: one hex, and the three amounts of finish its surface carries.
 *
 * Everything else about it — where it sits in HSL, which family it belongs to,
 * how hot it burns, how far it reads, what it weighs — is generated from those
 * four, so the application can write none of it.
 */
export const colors = pgTable("color", {
  productId: uuid("product_id").primaryKey(),
  /** Always `color`; it is half of the key back to a product of that kind. */
  kind: productKind("kind").notNull().default("color"),

  hex: text("hex").notNull(),
  /** 5 is a mirror, 95 is chalk. */
  roughness: smallint("roughness").notNull(),
  /**
   * Nanometers of interference coating. Zero is bare paint.
   *
   * Which colors it shows follows from the thickness and the refractive index
   * of the material, so neither they nor the arc they walk is stored.
   */
  coatingNanometers: smallint("coating_nanometers").notNull(),
  /** How hard the pigment gives off its own light. Zero for most colors. */
  emission: smallint("emission").notNull(),

  hue: smallint("hue").generatedAlwaysAs(sql`hex_to_hue(hex)`),
  saturation: smallint("saturation").generatedAlwaysAs(sql`hex_to_saturation(hex)`),
  lightness: smallint("lightness").generatedAlwaysAs(sql`hex_to_lightness(hex)`),
  /** The nearest landmark in RGB space, which is what a family name is. */
  family: text("family").generatedAlwaysAs(sql`color_family(hex)`),

  temperatureKelvin: smallint("temperature_kelvin").generatedAlwaysAs(
    sql`hex_to_temperature(hex)`,
  ),
  reachCentimeters: integer("reach_centimeters").generatedAlwaysAs(
    sql`color_reach(hex, roughness, emission)`,
  ),
  weightGrams: integer("weight_grams").generatedAlwaysAs(sql`hex_to_weight(hex)`),
});

/**
 * A finisher: the one thing a tin does, in the column that says which.
 *
 * Exactly one of the three amounts is present and the other two are absent, so
 * what a tin is needs no threshold to recover and no extra column to declare —
 * `finisher_does_one_thing` in the database counts them. Its dimension follows
 * the same column, since a tin that changes no texture has no grain to quote.
 */
export const finishers = pgTable("finisher", {
  productId: uuid("product_id").primaryKey(),
  /** Always `finisher`; it is half of the key back to a product of that kind. */
  kind: productKind("kind").notNull().default("finisher"),

  /** 5 is a mirror, 95 is chalk. Present on a tin sold for the surface it leaves. */
  roughness: smallint("roughness"),
  /** Nanometers of interference coating it lays down. */
  coatingNanometers: smallint("coating_nanometers"),
  /** How hard it makes a pigment give off its own light. */
  emission: smallint("emission"),

  grainMicrometers: smallint("grain_micrometers").generatedAlwaysAs(
    sql`finish_grain(roughness)`,
  ),
  reachCentimeters: integer("reach_centimeters").generatedAlwaysAs(
    sql`emission_reach(emission)`,
  ),
  weightGrams: integer("weight_grams").generatedAlwaysAs(
    sql`finisher_weight(roughness, coating_nanometers, emission)`,
  ),
});

/** A shifter: which way round the wheel it turns a color, and how far. */
export const shifters = pgTable("shifter", {
  productId: uuid("product_id").primaryKey(),
  /** Always `shifter`; it is half of the key back to a product of that kind. */
  kind: productKind("kind").notNull().default("shifter"),

  direction: shiftDirection("direction").notNull(),
  arcDegrees: smallint("arc_degrees").notNull(),

  torqueMillinewtonMeters: integer("torque_millinewton_meters").generatedAlwaysAs(
    sql`shift_torque(arc_degrees)`,
  ),
  backlashMicrometers: integer("backlash_micrometers").generatedAlwaysAs(
    sql`shift_backlash(direction, arc_degrees)`,
  ),
  weightGrams: integer("weight_grams").generatedAlwaysAs(
    sql`shift_weight(direction, arc_degrees)`,
  ),
});

/** The images of a product, in the order they are shown. */
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

/** What shoppers said. One review per person per product. */
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
 * A product with its variant, its foundry and its rating already joined, so a
 * search reads one relation instead of four.
 *
 * Ratings are aggregated here rather than stored on `product`, so a rating can
 * never disagree with the reviews it came from. The three finish amounts are
 * COALESCEd across the two kinds that carry them, so a filter on roughness
 * finds it wherever it lives. If this ever needs to be fast, `MATERIALIZED` is
 * the only word that changes — no application code moves.
 */
export const productListing = pgView("product_listing", {
  id: uuid("id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  stockQuantity: integer("stock_quantity").notNull(),
  kind: productKind("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  searchVector: tsvector("search_vector").notNull(),

  hex: text("hex"),
  hue: smallint("hue"),
  saturation: smallint("saturation"),
  lightness: smallint("lightness"),
  family: text("family"),
  temperatureKelvin: smallint("temperature_kelvin"),
  reachCentimeters: integer("reach_centimeters"),

  roughness: smallint("roughness"),
  coatingNanometers: smallint("coating_nanometers"),
  emission: smallint("emission"),
  grainMicrometers: smallint("grain_micrometers"),
  finisherReachCentimeters: integer("finisher_reach_centimeters"),

  direction: shiftDirection("direction"),
  arcDegrees: smallint("arc_degrees"),
  torqueMillinewtonMeters: integer("torque_millinewton_meters"),
  backlashMicrometers: integer("backlash_micrometers"),

  weightGrams: integer("weight_grams").notNull(),

  brandId: uuid("brand_id").notNull(),
  brandSlug: text("brand_slug").notNull(),
  brandName: text("brand_name").notNull(),
  brandSearchVector: tsvector("brand_search_vector").notNull(),

  ratingAverage: numericAsNumber("rating_average").notNull(),
  ratingCount: integer("rating_count").notNull(),
}).existing();

/** Which schema files have run, so a rerun applies only what is new. */
export const schemaMigrations = pgTable("schema_migration", {
  name: text("name").primaryKey(),
  appliedAt: createdAt(),
});

/** Every table and view, as the query builder is typed against. */
export const schema = {
  users,
  oauthIdentities,
  sessions,
  refreshTokens,
  passwordResetTokens,
  brands,
  products,
  colors,
  finishers,
  shifters,
  productImages,
  productReviews,
  productListing,
  schemaMigrations,
};

/** Re-exported so query files can build raw fragments without another import. */
export { sql };
