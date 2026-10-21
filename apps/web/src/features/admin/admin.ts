/**
 * The admin's reads and writes, and how the shop's staff rules reach the
 * page. Every admin request is answered only for staff whose second factor
 * is set up and confirmed within the last hours. When it is not, the API
 * refuses with `TwoFactorSetupRequired` or `TwoFactorVerificationRequired`,
 * and the staff gate shows what to do instead of the page.
 */

import { Permission, type ErrorResponse, type StaffRole } from "@prism/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";

/** What stands between a staff member and the admin. */
export type GateState = "open" | "setup" | "verify" | "forbidden";

/** One entry of the admin's navigation, and the permission that shows it. */
export type AdminSection = Readonly<{ path: string; label: string; permission: Permission | "any-staff" }>;

export const AdminAccess = {
  /** The admin's sections, in the order the navigation lists them. */
  SECTIONS: [
    { path: "/admin", label: "Dashboard", permission: "any-staff" },
    { path: "/admin/orders", label: "Orders", permission: "orders.view" },
    { path: "/admin/products", label: "Products", permission: "catalog.manage" },
    { path: "/admin/categories", label: "Categories", permission: "catalog.manage" },
    { path: "/admin/brands", label: "Brands", permission: "catalog.manage" },
    { path: "/admin/import", label: "Import", permission: "catalog.import" },
    { path: "/admin/reviews", label: "Reviews", permission: "reviews.moderate" },
    { path: "/admin/shipping", label: "Delivery options", permission: "delivery.manage" },
    { path: "/admin/users", label: "Accounts", permission: "customers.view" },
    { path: "/admin/audit", label: "Audit log", permission: "audit.view" },
  ] as const satisfies readonly AdminSection[],

  /** The sections `roles` may open. */
  sectionsFor: (roles: readonly StaffRole[]): readonly AdminSection[] =>
    AdminAccess.SECTIONS.filter((section) => (section.permission === "any-staff" ? roles.length > 0 : Permission.can(roles, section.permission))),

  /** What a refusal of an admin request means for the gate; `open` for anything that is not about staff access. */
  gateOf: (failure: ErrorResponse["error"] | undefined): GateState => {
    switch (failure?.code) {
      case "TwoFactorSetupRequired":
        return "setup";
      case "TwoFactorVerificationRequired":
        return "verify";
      case "Forbidden":
        return "forbidden";
      default:
        return "open";
    }
  },

  /**
   * Called with every failed request. A second factor that expired while a
   * page was open makes the gate ask for it again, instead of every section
   * failing on its own.
   */
  onFailure: (client: QueryClient, reason: unknown): void => {
    if (AdminAccess.gateOf(Api.failureOf(reason)) === "verify") {
      void client.invalidateQueries({ queryKey: AdminKeys.summary });
    }
  },
} as const;

export const AdminKeys = {
  all: ["admin"] as const,
  summary: ["admin", "summary"] as const,
  list: (resource: string, query: string) => ["admin", resource, "list", query] as const,
  one: (resource: string, id: string) => ["admin", resource, "one", id] as const,
} as const;

/** One admin read, by its path under `/admin`. */
export const useAdminRead = <T>(key: readonly unknown[], path: string, isEnabled = true) =>
  useQuery({
    queryKey: key,
    queryFn: ({ signal }) => Api.get<T>(`/admin${path}`, signal),
    placeholderData: keepPreviousData,
    enabled: isEnabled,
    retry: false,
  });

/** One admin write. Every admin read is refreshed once it succeeds, so no list shows what it changed as it was. */
export const useAdminWrite = <Input, Output>(write: (input: Input) => Promise<Output>) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: write,
    onSuccess: () => client.invalidateQueries({ queryKey: AdminKeys.all }),
  });
};
