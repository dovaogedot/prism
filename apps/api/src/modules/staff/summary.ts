/**
 * The admin dashboard: a count for each kind of work waiting, shown only to
 * accounts whose roles can do that work.
 */

import { Permission, type AdminSummary, type StaffRole } from "@prism/shared";

/** One count of the dashboard, and the permission that may see it. */
export type SummaryCounter = Readonly<{ permission: Permission; count: () => Promise<number> }>;

/** Where each count of the dashboard comes from. Each module supplies its own. */
export type SummaryCounters = Readonly<Record<keyof AdminSummary, SummaryCounter>>;

export const StaffSummary = {
  /** The counts `roles` may see, each read once. */
  of: async (counters: SummaryCounters, roles: readonly StaffRole[]): Promise<AdminSummary> => {
    const visible = Object.entries(counters).filter(([, counter]) => Permission.can(roles, counter.permission));
    const counts = await Promise.all(visible.map(async ([name, counter]) => [name, await counter.count()] as const));

    return Object.fromEntries(counts);
  },
} as const;
