/**
 * Staff roles and the permissions they grant. Every account is a customer;
 * a staff role adds permissions on top, and one account can hold several.
 * The API checks a permission on every admin route, and the browser hides
 * what an account cannot use, both through `Permission.can`.
 */

import { z } from "zod";

/** One staff job. An account holds any set of them, or none. */
export type StaffRole = (typeof StaffRole.NAMES)[number];
export const StaffRole = {
  NAMES: ["moderator", "content_manager", "delivery_manager", "support", "admin"] as const,
  schema: z.enum(["moderator", "content_manager", "delivery_manager", "support", "admin"]),
  label: {
    moderator: "Moderator",
    content_manager: "Content manager",
    delivery_manager: "Delivery manager",
    support: "Support",
    admin: "Admin",
  } as const satisfies Record<"moderator" | "content_manager" | "delivery_manager" | "support" | "admin", string>,
  /** The job each role does, as the staff pages explain it. */
  description: {
    moderator: "Keeps reviews fair: approves, rejects and deletes them.",
    content_manager:
      "Owns the catalog: products, images, categories and brands, bulk import, and the featured products.",
    delivery_manager:
      "Gets paid orders to customers: moves them through processing, shipped and delivered, and sets the delivery options.",
    support: "Helps customers: finds their accounts and orders, cancels orders that have not shipped, and refunds.",
    admin: "Runs the shop: every permission, plus staff roles, account status, 2FA resets and the audit log.",
  } as const satisfies Record<"moderator" | "content_manager" | "delivery_manager" | "support" | "admin", string>,
} as const;

/**
 * One thing a staff member may do. Spelled out rather than read off `NAMES`,
 * because the companion's functions take one.
 */
export type Permission =
  | "reviews.moderate"
  | "catalog.manage"
  | "catalog.import"
  | "orders.view"
  | "orders.fulfill"
  | "delivery.manage"
  | "orders.refund"
  | "customers.view"
  | "staff.manage"
  | "audit.view";

export const Permission = {
  NAMES: [
    "reviews.moderate",
    "catalog.manage",
    "catalog.import",
    "orders.view",
    "orders.fulfill",
    "delivery.manage",
    "orders.refund",
    "customers.view",
    "staff.manage",
    "audit.view",
  ] as const satisfies readonly Permission[],
  label: {
    "reviews.moderate": "See the review queue; approve, reject and delete reviews",
    "catalog.manage":
      "Create, edit and delete products, images, categories and brands; feature products on the home page",
    "catalog.import": "Bulk import products from JSON or CSV",
    "orders.view": "See every order, with its lines, contact, addresses and payment",
    "orders.fulfill": "Move orders to processing, shipped and delivered",
    "delivery.manage": "Create, edit and deactivate delivery options",
    "orders.refund": "Cancel orders that have not shipped, and refund orders",
    "customers.view": "See accounts, with their orders and reviews",
    "staff.manage": "Give and take staff roles, disable and enable accounts, reset 2FA, sign accounts out",
    "audit.view": "Read the audit log",
  } as const satisfies Record<Permission, string>,
  /** The roles each permission is granted to. */
  grantedTo: {
    "reviews.moderate": ["moderator", "admin"],
    "catalog.manage": ["content_manager", "admin"],
    "catalog.import": ["content_manager", "admin"],
    "orders.view": ["delivery_manager", "support", "admin"],
    "orders.fulfill": ["delivery_manager", "admin"],
    "delivery.manage": ["delivery_manager", "admin"],
    "orders.refund": ["support", "admin"],
    "customers.view": ["support", "admin"],
    "staff.manage": ["admin"],
    "audit.view": ["admin"],
  } as const satisfies Record<Permission, readonly StaffRole[]>,

  /** Whether an account holding `roles` may do `permission`. */
  can: (roles: readonly StaffRole[], permission: Permission): boolean => {
    const granted: readonly StaffRole[] = Permission.grantedTo[permission];
    return roles.some((role) => granted.includes(role));
  },

  /** Every permission `roles` grant together, in the order of `NAMES`. */
  of: (roles: readonly StaffRole[]): readonly Permission[] =>
    Permission.NAMES.filter((permission) => Permission.can(roles, permission)),
} as const;
