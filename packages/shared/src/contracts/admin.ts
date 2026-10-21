/**
 * The admin as the API serves it and the browser sends it. Every route under
 * `/admin` checks a permission; these are the shapes of what passes.
 */

import { z } from "zod";
import { Email, UserId, type OAuthProvider } from "./auth.ts";
import { BrandId, CategoryId, ImageId, Slug, type ProductId, type ProductImage } from "./catalog.ts";
import { OptionalText, ReviewStatus, type OwnReview } from "./reviews.ts";
import { ShippingMethodCode, type ShippingOption } from "./checkout.ts";
import { CalendarDay, OrderSort, OrderStatus, type OrderDetail, type OrderSummary } from "./orders.ts";
import { StaffRole } from "./staff.ts";

/** One page of a list. */
export type Page<T> = Readonly<{
  items: readonly T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}>;

export const Page = {
  /** The page and page size every admin list takes. */
  params: {
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  },

  /** How many pages `total` items fill, never fewer than one. */
  count: (total: number, perPage: number): number => Math.max(1, Math.ceil(total / perPage)),
} as const;

/** What the dashboard counts. Each count is present only for an account whose roles can act on it. */
export type AdminSummary = Readonly<{
  /** Paid and processing orders waiting for the next step. */
  ordersToFulfill?: number;
  reviewsWaiting?: number;
  /** Products with 5 or fewer in stock. */
  lowStockProducts?: number;
  /** Orders paid for today, in the shop's time zone. */
  paidToday?: number;
}>;

/** A validated `PUT /admin/users/:id/roles` body: the account's whole set of staff roles. */
export type RoleChange = z.infer<typeof RoleChange.schema>;
export const RoleChange = {
  schema: z.strictObject({
    roles: z
      .array(StaffRole.schema)
      .max(StaffRole.NAMES.length)
      .transform((roles) => StaffRole.NAMES.filter((name) => roles.includes(name))),
  }),
} as const;

/** An account as the staff lists show it. */
export type AdminUserSummary = Readonly<{
  id: UserId;
  email: Email;
  roles: readonly StaffRole[];
  twoFactorEnabled: boolean;
  /** Present while the account is disabled. */
  disabledAt?: string;
  providers: readonly OAuthProvider[];
  createdAt: string;
}>;

/** An account as its staff page shows it. */
export type AdminUserDetail = AdminUserSummary &
  Readonly<{
    hasPassword: boolean;
    /** Present once the customer set one. */
    fullName?: string;
    phone?: string;
    /** Sessions that are signed in now. */
    liveSessions: number;
    /** The most recent orders, newest first. */
    orders: readonly OrderSummary[];
  }>;

/** The query string of `GET /admin/users`. */
export type AdminUserQuery = z.infer<typeof AdminUserQuery.schema>;
export const AdminUserQuery = {
  schema: z.object({
    /** Only accounts that hold this staff role. */
    role: StaffRole.schema.optional(),
    /** Only accounts that hold any staff role. */
    staff: z.stringbool().optional(),
    /** The one account with exactly this address. */
    email: Email.schema.optional(),
    ...Page.params,
  }),
} as const;

/** One audit log entry. */
export type AuditEventView = Readonly<{
  id: number;
  at: string;
  /** Absent for something the system did, such as creating the first admin. */
  actor?: Readonly<{ id: UserId; email: Email }>;
  /** The actor's staff roles when it acted. */
  actorRoles: readonly StaffRole[];
  /** What happened, such as `product.update`. */
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  /** The fields that changed, as `[before, after]`. */
  changes?: Readonly<Record<string, readonly [unknown, unknown]>>;
  /** The address the actor acted from. */
  ip?: string;
}>;

/** The query string of `GET /admin/audit`. Both ends of the date range count. */
export type AuditQuery = z.infer<typeof AuditQuery.schema>;
export const AuditQuery = {
  schema: z
    .object({
      actor: UserId.schema.optional(),
      /** An exact action, or the start of one ending in a dot, such as `product.`. */
      action: z.string().trim().min(1).max(60).regex(/^[a-z_.]+$/, "Not an action name.").optional(),
      targetType: z.string().trim().min(1).max(40).regex(/^[a-z_]+$/, "Not a target type.").optional(),
      targetId: z.string().trim().min(1).max(80).optional(),
      from: CalendarDay.schema.optional(),
      to: CalendarDay.schema.optional(),
      ...Page.params,
    })
    .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
      message: "The start date must not be after the end date.",
      path: ["to"],
    }),
} as const;

/** A delivery option as the admin edits it. On `PUT` the code in the path names the option, and the body's must match. */
export type ShippingMethodInput = z.infer<typeof ShippingMethodInput.schema>;
export const ShippingMethodInput = {
  schema: z
    .strictObject({
      code: ShippingMethodCode.schema,
      name: z.string().trim().min(1, "Enter a name.").max(60, "Use at most 60 characters."),
      priceCents: z
        .number({ error: "Enter a price." })
        .int("Enter whole cents.")
        .min(0, "The price cannot be negative.")
        .max(100_000, "Use at most €1,000.00."),
      /** Left out when the option never ships free. */
      freeFromCents: z
        .number()
        .int("Enter whole cents.")
        .min(1, "Enter a threshold above zero, or none.")
        .max(10_000_000, "Use at most €100,000.00.")
        .optional(),
      minDays: z.number().int("Enter whole days.").min(1, "Use 1 to 30 days.").max(30, "Use 1 to 30 days."),
      maxDays: z.number().int("Enter whole days.").min(1, "Use 1 to 30 days.").max(30, "Use 1 to 30 days."),
      isActive: z.boolean(),
      position: z.number().int().min(0).max(1000),
    })
    .refine((input) => input.minDays <= input.maxDays, {
      message: "The latest day cannot come before the earliest.",
      path: ["maxDays"],
    }),
} as const;

/** A delivery option as the admin lists it. */
export type ShippingMethodView = ShippingOption &
  Readonly<{
    isActive: boolean;
    position: number;
    /** How many orders were placed with it; one or more means it can be deactivated but not deleted. */
    orderCount: number;
  }>;

/** A carrier's tracking number, as staff type it. */
export const TrackingNumber = {
  schema: z
    .string({ error: "Enter the tracking number." })
    .trim()
    .min(4, "Enter the tracking number.")
    .max(40, "Use at most 40 characters.")
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits and dashes."),
} as const;

/** A validated `POST /admin/orders/:id/status` body: the next step of fulfillment. */
export type OrderStatusChange = z.infer<typeof OrderStatusChange.schema>;
export const OrderStatusChange = {
  schema: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("processing") }),
    z.strictObject({ status: z.literal("shipped"), trackingNumber: TrackingNumber.schema }),
    z.strictObject({ status: z.literal("delivered") }),
  ]),
} as const;

/** The query string of `GET /admin/orders`. Both ends of the date range count. */
export type AdminOrderQuery = z.infer<typeof AdminOrderQuery.schema>;
export const AdminOrderQuery = {
  schema: z
    .object({
      status: z
        .union([OrderStatus.schema, z.array(OrderStatus.schema).max(OrderStatus.NAMES.length)])
        .transform((value) => (typeof value === "string" ? [value] : value))
        .optional(),
      from: CalendarDay.schema.optional(),
      to: CalendarDay.schema.optional(),
      /** The order with exactly this number. */
      number: z.coerce.number().int().positive().optional(),
      /** The orders whose contact email is exactly this. */
      email: Email.schema.optional(),
      sort: OrderSort.schema.default("newest"),
      ...Page.params,
    })
    .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
      message: "The start date must not be after the end date.",
      path: ["to"],
    }),
} as const;

/** An order as the admin lists it. */
export type AdminOrderSummary = OrderSummary &
  Readonly<{
    customerName: string;
    customerEmail: Email;
    /** True when nobody was signed in to place it. */
    isGuest: boolean;
  }>;

/** An order as its admin page shows it, with the actions it allows. */
export type AdminOrderDetail = OrderDetail &
  Readonly<{
    /** The account that placed it; absent for a guest. */
    userId?: UserId;
    /** The next step of fulfillment; absent when none follows. */
    nextStatus?: "processing" | "shipped" | "delivered";
    /** Whether it has not shipped, so the shop may still cancel it. */
    canCancel: boolean;
    /** Whether it shipped and has not been refunded. */
    canRefund: boolean;
  }>;

/** What a picture shows, for people who cannot see it. Required of every product picture. */
export const ImageAlt = {
  schema: z
    .string({ error: "Describe what the picture shows." })
    .trim()
    .min(1, "Describe what the picture shows.")
    .max(200, "Use at most 200 characters."),
} as const;

/** A validated `PUT /admin/products/:id/images` body: every picture of the product, in its new order, with its text. */
export type ImageOrderInput = z.infer<typeof ImageOrderInput.schema>;
export const ImageOrderInput = {
  schema: z.strictObject({
    images: z
      .array(z.strictObject({ id: ImageId.schema, alt: ImageAlt.schema }))
      .min(1)
      .max(12)
      .refine((images) => new Set(images.map((image) => image.id)).size === images.length, "Each picture appears once."),
  }),
} as const;

/** The query string of `GET /admin/reviews`. */
export type AdminReviewQuery = z.infer<typeof AdminReviewQuery.schema>;
export const AdminReviewQuery = {
  schema: z.object({
    status: ReviewStatus.schema.default("pending"),
    ...Page.params,
  }),
} as const;

/** A review as the moderation queue shows it. */
export type AdminReviewView = OwnReview &
  Readonly<{
    product: Readonly<{ slug: Slug; name: string }>;
    userId: UserId;
    /** Present once a moderator acted on it. */
    moderatedAt?: string;
  }>;

/** The rules every product field follows, in the admin's form and in an import alike. */
export const ProductFields = {
  name: z.string({ error: "Enter a name." }).trim().min(1, "Enter a name.").max(200, "Use at most 200 characters."),
  description: z
    .string({ error: "Enter a description." })
    .trim()
    .min(1, "Enter a description.")
    .max(5000, "Use at most 5,000 characters."),
  priceCents: z
    .number({ error: "Enter a price." })
    .int("Enter whole cents.")
    .min(1, "The price must be at least €0.01.")
    .max(10_000_000, "Use at most €100,000.00."),
  stock: z
    .number({ error: "Enter the stock." })
    .int("Enter a whole number.")
    .min(0, "The stock cannot be negative.")
    .max(1_000_000, "Use at most 1,000,000."),
  weightGrams: z
    .number({ error: "Enter the weight." })
    .int("Enter whole grams.")
    .min(1, "Enter at least 1 gram.")
    .max(1_000_000, "Use at most 1,000,000 grams."),
  millimeters: z
    .number({ error: "Enter the size." })
    .int("Enter whole millimeters.")
    .min(1, "Enter at least 1 mm.")
    .max(10_000, "Use at most 10,000 mm."),
  /** A slug a person types: required, then held to the slug rules. */
  slug: z.string({ error: "Enter a slug." }).trim().min(1, "Enter a slug.").pipe(Slug.schema),
  /** A category or brand named by its slug in an import. */
  reference: z.string({ error: "Name it by its slug." }).trim().min(1, "Name it by its slug.").pipe(Slug.schema),
  propertyName: z.string().trim().min(1, "Name the property.").max(40, "Use at most 40 characters."),
  propertyValue: z.string().trim().min(1, "Enter a value.").max(200, "Use at most 200 characters."),
  /** The most named properties one product carries. */
  MAX_PROPERTIES: 30,
} as const;

/** A product's named facts, with names unique however they are capitalized. */
export const ProductProperties = {
  schema: z
    .array(z.strictObject({ name: ProductFields.propertyName, value: ProductFields.propertyValue }))
    .max(ProductFields.MAX_PROPERTIES, "Use at most 30 properties.")
    .refine(
      (properties) => new Set(properties.map((property) => property.name.toLowerCase())).size === properties.length,
      "Each property name appears once.",
    ),
} as const;

/** A validated product, as `POST` and `PUT /admin/products` take it. */
export type ProductInput = z.infer<typeof ProductInput.schema>;
export const ProductInput = {
  schema: z.strictObject({
    name: ProductFields.name,
    slug: ProductFields.slug,
    description: ProductFields.description,
    priceCents: ProductFields.priceCents,
    stock: ProductFields.stock,
    categoryId: CategoryId.schema,
    brandId: BrandId.schema,
    weightGrams: ProductFields.weightGrams,
    widthMm: ProductFields.millimeters,
    heightMm: ProductFields.millimeters,
    depthMm: ProductFields.millimeters,
    properties: ProductProperties.schema,
    /** Whether the home page shows it among the featured products. */
    isFeatured: z.boolean(),
  }),
} as const;

/** The query string of `GET /admin/products`. */
export type AdminProductQuery = z.infer<typeof AdminProductQuery.schema>;
export const AdminProductQuery = {
  schema: z.object({
    /** Part of the name or the slug. */
    q: z.string().trim().max(120).optional(),
    category: Slug.schema.optional(),
    brand: Slug.schema.optional(),
    featured: z.stringbool().optional(),
    /** Only products with 5 or fewer in stock. */
    lowStock: z.stringbool().optional(),
    sort: z.enum(["name", "newest", "stock", "price"]).default("name"),
    ...Page.params,
  }),
} as const;

/** A product as the admin lists it. */
export type AdminProductSummary = Readonly<{
  id: ProductId;
  slug: Slug;
  name: string;
  priceCents: number;
  stock: number;
  category: Readonly<{ slug: Slug; name: string }>;
  brand: Readonly<{ slug: Slug; name: string }>;
  isFeatured: boolean;
  /** The first picture, when there is one. */
  image?: ProductImage;
  updatedAt: string;
}>;

/** A product as its admin page edits it. */
export type AdminProductDetail = ProductInput &
  Readonly<{
    id: ProductId;
    images: readonly ProductImage[];
    createdAt: string;
    updatedAt: string;
  }>;

/** A validated category, as `POST` and `PUT /admin/categories` take it. */
export type CategoryInput = z.infer<typeof CategoryInput.schema>;
export const CategoryInput = {
  schema: z.strictObject({
    slug: ProductFields.slug,
    name: z.string({ error: "Enter a name." }).trim().min(1, "Enter a name.").max(80, "Use at most 80 characters."),
    /** What the category page says about it; empty is none. */
    description: OptionalText.of(1000, "Use at most 1,000 characters."),
  }),
} as const;

/** A validated brand, as `POST` and `PUT /admin/brands` take it. */
export type BrandInput = z.infer<typeof BrandInput.schema>;
export const BrandInput = {
  schema: z.strictObject({
    slug: ProductFields.slug,
    name: z.string({ error: "Enter a name." }).trim().min(1, "Enter a name.").max(80, "Use at most 80 characters."),
  }),
} as const;

/** A category as the admin lists it. */
export type AdminCategory = Readonly<{
  id: CategoryId;
  slug: Slug;
  name: string;
  description?: string;
  /** Products filed under it; one or more means it cannot be deleted. */
  productCount: number;
}>;

/** A brand as the admin lists it. */
export type AdminBrand = Readonly<{ id: BrandId; slug: Slug; name: string; productCount: number }>;

/**
 * One product of an import file, as checked. Categories and brands are named
 * by slug and must exist; a row with a slug that exists updates that product.
 */
export type ImportRow = z.infer<typeof ImportRow.schema>;
export const ImportRow = {
  schema: z.strictObject({
    slug: ProductFields.slug,
    name: ProductFields.name,
    description: ProductFields.description,
    priceCents: ProductFields.priceCents,
    stock: ProductFields.stock,
    category: ProductFields.reference,
    brand: ProductFields.reference,
    weightGrams: ProductFields.weightGrams,
    widthMm: ProductFields.millimeters,
    heightMm: ProductFields.millimeters,
    depthMm: ProductFields.millimeters,
    featured: z.boolean().default(false),
    properties: ProductProperties.schema.default([]),
  }),
} as const;

/** What an import found: what it would do or did, and every problem it found. */
export type ImportReport = Readonly<{
  /** True when nothing was written because only a check was asked for. */
  dryRun: boolean;
  created: number;
  updated: number;
  /** One issue per bad cell: the row, counted from 1 as the file's own rows are, the column, and what is wrong. */
  issues: readonly Readonly<{ row: number; column: string; message: string }>[];
}>;
