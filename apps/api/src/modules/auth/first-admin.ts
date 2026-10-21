/**
 * The shop's first admin, from the environment. When no account holds the
 * admin role, the account named by `ADMIN_EMAIL` gets it: an existing
 * account keeps its own password and 2FA, and a new one is created with
 * `ADMIN_PASSWORD` and with 2FA already on under `ADMIN_TOTP_SECRET`, so the
 * admin never exists without a second factor. Once an admin exists, the
 * variables change nothing.
 */

import type { FirstAdminSettings } from "../../config.ts";
import type { Clock } from "../../platform/clock.ts";
import type { Hasher } from "../../platform/hasher.ts";
import type { AccountAdminRepository, FirstAdminOutcome } from "./admin-repository.ts";

/** What making the first admin needs. */
export type FirstAdminDependencies = Readonly<{
  repository: AccountAdminRepository;
  hasher: Hasher;
  clock: Clock;
  /** Left out when the environment names no first admin. */
  settings?: FirstAdminSettings;
}>;

export const FirstAdmin = {
  /** Gives the shop its first admin when it has none. Resolves to what it did; `undefined` without settings. */
  ensure: async (deps: FirstAdminDependencies): Promise<FirstAdminOutcome | undefined> => {
    const { settings } = deps;
    if (settings === undefined) return undefined;

    return deps.repository.ensureFirstAdmin({
      email: settings.email,
      passwordHash: await deps.hasher.hash(settings.password),
      totpSecret: settings.totpSecret,
      now: deps.clock.now(),
    });
  },
} as const;
