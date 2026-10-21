/**
 * The statements behind the account pages of the admin. Every change writes
 * its audit entry in the same transaction, and every change that could take
 * the shop's last admin away locks the admins first, so two such changes at
 * once cannot both see another admin left.
 */

import {
  Email,
  Page,
  StaffRole,
  type AdminUserQuery,
  type AdminUserSummary,
  type OAuthProvider,
  type UserId,
} from "@prism/shared";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client.ts";
import { sessions, users, type RevocationReason } from "../../db/schema.ts";
import type { BlindIndex, FieldCipher } from "../../platform/cipher.ts";
import type { PasswordHash } from "../../platform/hasher.ts";
import type { TotpSecret } from "../../platform/totp.ts";
import type { AuditEntry, AuditLog, StaffActor } from "../staff/audit.ts";
import { AuthRepository } from "./repository.ts";

/** An account as its staff page reads it, before the orders are added. */
export type AccountDetail = AdminUserSummary &
  Readonly<{ hasPassword: boolean; fullName?: string; phone?: string; liveSessions: number }>;

/** What a change of roles found. */
export type RolesOutcome =
  | Readonly<{ _tag: "Changed"; before: readonly StaffRole[]; email: Email }>
  | Readonly<{ _tag: "Unchanged" }>
  | Readonly<{ _tag: "NotFound" }>
  | Readonly<{ _tag: "LastAdmin" }>;

/** What a change of an account's status, 2FA or sessions found. */
export type AccountOutcome =
  | Readonly<{ _tag: "Changed" }>
  | Readonly<{ _tag: "Unchanged" }>
  | Readonly<{ _tag: "NotFound" }>
  | Readonly<{ _tag: "LastAdmin" }>;

/** What making the first admin did. */
export type FirstAdminOutcome =
  | Readonly<{ _tag: "Created"; userId: UserId }>
  | Readonly<{ _tag: "Promoted"; userId: UserId }>
  | Readonly<{ _tag: "Present" }>;

/** Every read and write of the account pages. */
export type AccountAdminRepository = Readonly<{
  list: (query: AdminUserQuery) => Promise<Page<AdminUserSummary>>;
  /** The account, with the sessions live at `now`. */
  detail: (userId: UserId, now: Date) => Promise<AccountDetail | undefined>;
  setRoles: (input: Readonly<{ userId: UserId; roles: readonly StaffRole[]; actor: StaffActor }>) => Promise<RolesOutcome>;
  setDisabled: (input: Readonly<{ userId: UserId; isDisabled: boolean; actor: StaffActor; now: Date }>) => Promise<AccountOutcome>;
  /** Turns the account's 2FA off and signs it out everywhere. */
  resetTwoFactor: (input: Readonly<{ userId: UserId; actor: StaffActor; now: Date }>) => Promise<AccountOutcome>;
  /** Ends every live session of the account. */
  signOut: (input: Readonly<{ userId: UserId; actor: StaffActor; now: Date }>) => Promise<AccountOutcome>;
  /**
   * Makes the account with `email` an admin when no account holds the role:
   * the existing account, or a new one with the password and 2FA on under
   * the secret. Changes nothing once an admin exists.
   */
  ensureFirstAdmin: (input: Readonly<{
    email: Email;
    passwordHash: PasswordHash;
    totpSecret: TotpSecret;
    now: Date;
  }>) => Promise<FirstAdminOutcome>;
}>;

/** An account row as the list and the detail read it. */
type AccountRow = Readonly<{
  id: UserId;
  email: Buffer;
  roles: StaffRole[];
  totpEnabledAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  providers: readonly OAuthProvider[];
}>;

export const AccountAdminRepository = {
  /** Serializes concurrent first-admin checks, across API processes too. */
  FIRST_ADMIN_LOCK: 4_242_002,

  create: (db: Database, cipher: FieldCipher, audit: AuditLog): AccountAdminRepository => {
    const summaryOf = (row: AccountRow): AdminUserSummary => ({
      id: row.id,
      email: cipher.open(row.email, Email.schema),
      roles: row.roles,
      twoFactorEnabled: row.totpEnabledAt !== null,
      ...(row.disabledAt === null ? {} : { disabledAt: row.disabledAt.toISOString() }),
      providers: row.providers,
      createdAt: row.createdAt.toISOString(),
    });

    const columns = {
      id: users.id,
      email: users.email,
      roles: users.roles,
      totpEnabledAt: users.totpEnabledAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      providers: AuthRepository.linkedProviders,
    };

    /**
     * Locks every enabled admin and the target, in one id order so two
     * changes never wait on each other in a cycle. Resolves to the enabled
     * admins and the target as they stand once locked.
     */
    const lockAdminsAnd = async (tx: Transaction, userId: UserId) => {
      const locked = await tx
        .select({ id: users.id, roles: users.roles, disabledAt: users.disabledAt, email: users.email })
        .from(users)
        .where(sql`(${users.id} = ${userId} OR ('admin' = ANY(${users.roles}) AND ${users.disabledAt} IS NULL))`)
        .orderBy(users.id)
        .for("update");

      return {
        admins: locked.filter((row) => row.roles.includes("admin") && row.disabledAt === null),
        target: locked.find((row) => row.id === userId),
      };
    };

    const revokeAll = (tx: Transaction, userId: UserId, now: Date, reason: RevocationReason) =>
      tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: reason })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });

    const entry = (actor: StaffActor, action: string, userId: UserId, summary: string, changes?: AuditEntry["changes"]): AuditEntry => ({
      actor,
      action,
      target: { type: "user", id: userId },
      summary,
      ...(changes === undefined ? {} : { changes }),
    });

    return {
      list: async (query) => {
        const conditions = and(
          query.role === undefined ? undefined : sql`${query.role} = ANY(${users.roles})`,
          query.staff === true ? sql`cardinality(${users.roles}) > 0` : undefined,
          query.staff === false ? sql`cardinality(${users.roles}) = 0` : undefined,
          query.email === undefined ? undefined : eq(users.emailIndex, cipher.index("account-email", query.email)),
        );

        const [rows, totals] = await Promise.all([
          db
            .select(columns)
            .from(users)
            .where(conditions)
            .orderBy(desc(users.createdAt), desc(users.id))
            .limit(query.perPage)
            .offset((query.page - 1) * query.perPage),
          db.select({ total: count() }).from(users).where(conditions),
        ]);
        const total = totals[0]?.total ?? 0;

        return {
          items: rows.map(summaryOf),
          total,
          page: query.page,
          perPage: query.perPage,
          totalPages: Page.count(total, query.perPage),
        };
      },

      detail: async (userId, now) => {
        const [row] = await db
          .select({ ...columns, passwordHash: users.passwordHash, fullName: users.fullName, phone: users.phone })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (row === undefined) return undefined;

        const [live] = await db
          .select({ total: count() })
          .from(sessions)
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));

        return {
          ...summaryOf(row),
          hasPassword: row.passwordHash !== null,
          ...(row.fullName === null ? {} : { fullName: cipher.open(row.fullName, z.string()) }),
          ...(row.phone === null ? {} : { phone: cipher.open(row.phone, z.string()) }),
          liveSessions: live?.total ?? 0,
        };
      },

      setRoles: ({ userId, roles, actor }) =>
        db.transaction(async (tx): Promise<RolesOutcome> => {
          const { admins, target } = await lockAdminsAnd(tx, userId);
          if (target === undefined) return { _tag: "NotFound" };

          const before = target.roles;
          const after = StaffRole.NAMES.filter((name) => roles.includes(name));
          if (before.length === after.length && before.every((role) => after.includes(role))) return { _tag: "Unchanged" };

          const losesAdmin = before.includes("admin") && !after.includes("admin") && target.disabledAt === null;
          if (losesAdmin && admins.length <= 1) return { _tag: "LastAdmin" };

          await tx.update(users).set({ roles: [...after] }).where(eq(users.id, userId));
          await audit.record(
            tx,
            entry(
              actor,
              "user.roles",
              userId,
              after.length === 0
                ? "Took every staff role from the account"
                : `Set the account's staff roles to ${after.map((role) => StaffRole.label[role].toLowerCase()).join(", ")}`,
              { roles: [before, after] },
            ),
          );

          return { _tag: "Changed", before, email: cipher.open(target.email, Email.schema) };
        }),

      setDisabled: ({ userId, isDisabled, actor, now }) =>
        db.transaction(async (tx): Promise<AccountOutcome> => {
          const { admins, target } = await lockAdminsAnd(tx, userId);
          if (target === undefined) return { _tag: "NotFound" };
          if ((target.disabledAt !== null) === isDisabled) return { _tag: "Unchanged" };

          if (isDisabled && target.roles.includes("admin") && admins.length <= 1) return { _tag: "LastAdmin" };

          await tx.update(users).set({ disabledAt: isDisabled ? now : null }).where(eq(users.id, userId));

          if (isDisabled) {
            const ended = await revokeAll(tx, userId, now, "account_disabled");
            await audit.record(
              tx,
              entry(actor, "user.disable", userId, `Disabled the account and ended ${ended.length} session(s)`, {
                disabled: [false, true],
              }),
            );
          } else {
            await audit.record(tx, entry(actor, "user.enable", userId, "Enabled the account", { disabled: [true, false] }));
          }

          return { _tag: "Changed" };
        }),

      resetTwoFactor: ({ userId, actor, now }) =>
        db.transaction(async (tx): Promise<AccountOutcome> => {
          const [reset] = await tx
            .update(users)
            .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null })
            .where(eq(users.id, userId))
            .returning({ id: users.id });
          if (reset === undefined) return { _tag: "NotFound" };

          const ended = await revokeAll(tx, userId, now, "two_factor_reset");
          await audit.record(
            tx,
            entry(actor, "user.reset_two_factor", userId, `Reset two-factor authentication and ended ${ended.length} session(s)`),
          );

          return { _tag: "Changed" };
        }),

      signOut: ({ userId, actor, now }) =>
        db.transaction(async (tx): Promise<AccountOutcome> => {
          const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
          if (target === undefined) return { _tag: "NotFound" };

          const ended = await revokeAll(tx, userId, now, "signed_out_by_staff");
          await audit.record(tx, entry(actor, "user.sign_out", userId, `Ended ${ended.length} session(s) of the account`));

          return { _tag: "Changed" };
        }),

      ensureFirstAdmin: ({ email, passwordHash, totpSecret, now }) =>
        db.transaction(async (tx): Promise<FirstAdminOutcome> => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${AccountAdminRepository.FIRST_ADMIN_LOCK})`);

          const [admin] = await tx.select({ id: users.id }).from(users).where(sql`'admin' = ANY(${users.roles})`).limit(1);
          if (admin !== undefined) return { _tag: "Present" };

          const emailIndex: BlindIndex = cipher.index("account-email", email);
          const [existing] = await tx
            .select({ id: users.id, roles: users.roles })
            .from(users)
            .where(eq(users.emailIndex, emailIndex));

          if (existing !== undefined) {
            const roles = StaffRole.NAMES.filter((name) => name === "admin" || existing.roles.includes(name));

            await tx.update(users).set({ roles }).where(eq(users.id, existing.id));
            await audit.record(tx, {
              actor: "system",
              action: "user.roles",
              target: { type: "user", id: existing.id },
              summary: "Made the account named by ADMIN_EMAIL the first admin",
              changes: { roles: [existing.roles, roles] },
            });

            return { _tag: "Promoted", userId: existing.id };
          }

          const [created] = await tx
            .insert(users)
            .values({
              email: cipher.seal(email),
              emailIndex,
              passwordHash,
              totpSecret: cipher.seal(totpSecret),
              totpEnabledAt: now,
              roles: ["admin"],
            })
            .returning({ id: users.id });
          if (created === undefined) throw new Error("the first admin's insert returned no row");

          await audit.record(tx, {
            actor: "system",
            action: "user.create",
            target: { type: "user", id: created.id },
            summary: "Created the first admin from ADMIN_EMAIL, with two-factor authentication on",
          });

          return { _tag: "Created", userId: created.id };
        }),
    };
  },
} as const;
