/**
 * Staff accounts as a test describes them: registered through the API, given
 * their roles, and with 2FA turned on the way a person turns it on, which
 * also marks the session as checked.
 */

import type { StaffRole, UserId } from "@prism/shared";
import { eq } from "drizzle-orm";
import { users } from "../../src/db/schema.ts";
import { jsonOf, registerUser, userIdOf, type Harness } from "./harness.ts";

/** An account made for a test: its id, its tokens, and the secret its authenticator holds. */
export type TestAccount = Readonly<{
  userId: UserId;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Present once 2FA is on. */
  secret?: string;
}>;

export const Staff = {
  /** Sends a request as `account`, or as a guest when it is left out. */
  call: (
    harness: Harness,
    account: TestAccount | undefined,
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: object,
  ) =>
    harness.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(payload === undefined ? {} : { payload }),
      ...(account === undefined ? {} : { headers: { authorization: `Bearer ${account.accessToken}` } }),
    }),

  /** Gives an existing account exactly `roles`. */
  setRoles: async (harness: Harness, userId: UserId, roles: readonly StaffRole[]): Promise<void> => {
    await harness.database.db.update(users).set({ roles: [...roles] }).where(eq(users.id, userId));
  },

  /** Turns 2FA on for `account` through the API, which marks its session as checked. Resolves to the secret. */
  enableTwoFactor: async (harness: Harness, account: TestAccount): Promise<string> => {
    const setup = await Staff.call(harness, account, "POST", "/auth/2fa/setup");
    const secret = new URL(String(jsonOf(setup)["uri"])).searchParams.get("secret");
    if (secret === null) throw new Error(`2FA setup gave no secret: ${setup.body}`);

    const enabled = await Staff.call(harness, account, "POST", "/auth/2fa/enable", { code: harness.totpCodeFor(secret) });
    if (enabled.statusCode !== 200) throw new Error(`enabling 2FA failed: ${enabled.body}`);

    return secret;
  },

  /** Registers `email`, gives it `roles`, and turns 2FA on unless told not to. */
  account: async (
    harness: Harness,
    email: string,
    roles: readonly StaffRole[],
    options: Readonly<{ hasTwoFactor?: boolean }> = {},
  ): Promise<TestAccount> => {
    const { accessToken, refreshToken } = await registerUser(harness, email);
    const userId = await userIdOf(harness, email);
    if (userId === undefined) throw new Error(`registering ${email} made no account`);

    await Staff.setRoles(harness, userId, roles);
    const account = { userId, email, accessToken, refreshToken };
    if (options.hasTwoFactor === false) return account;

    return { ...account, secret: await Staff.enableTwoFactor(harness, account) };
  },

  /** Moves the clock past the current 30-second step, so the next code is a fresh one. */
  nextCode: (harness: Harness): void => {
    harness.clock.advanceSeconds(30);
  },
} as const;
