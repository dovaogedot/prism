/**
 * The account's links, which the header's account menu and the drawer both
 * list, so the two never drift apart.
 */

import type { StaffRole } from "@prism/shared";
import { NextPath } from "../../features/auth/next-path.ts";

/** One page of the account. */
export type AccountLink = Readonly<{ to: string; label: string }>;

export const AccountLinks = {
  /** The pages a signed-in account opens, in menu order; the admin only for staff. */
  listFor: (roles: readonly StaffRole[]): readonly AccountLink[] => [
    { to: "/account/orders", label: "Orders" },
    { to: "/account", label: "Account" },
    { to: "/account/addresses", label: "Addresses" },
    ...(roles.length === 0 ? [] : [{ to: "/admin", label: "Admin" }]),
  ],

  /** Where "Sign in" goes from the page at `path`: the sign-in page, which comes back to it. */
  signInFrom: (path: string): string => `/login${NextPath.query(path)}`,
} as const;
