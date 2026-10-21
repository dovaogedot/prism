/**
 * Every database statement the accounts module makes: a customer's own
 * profile and saved addresses. Every value is sealed on the way in and
 * opened on the way out. An account keeps at most a fixed number of
 * addresses, and at most one of them is the default.
 */

import { ShippingAddress, type AddressId, type SavedAddress, type SavedAddressInput, type UserId } from "@prism/shared";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client.ts";
import { addresses, users } from "../../db/schema.ts";
import type { FieldCipher } from "../../platform/cipher.ts";

/** A customer's profile, opened. Each field is absent until the customer sets it. */
export type ProfileRecord = Readonly<{ fullName?: string; phone?: string }>;

/** What adding a saved address found. */
export type AddAddressOutcome = Readonly<{ _tag: "Added"; id: AddressId }> | Readonly<{ _tag: "LimitReached" }>;

/** Every read and write the accounts module makes. */
export type AccountRepository = Readonly<{
  /** The profile; `undefined` when there is no such account. */
  profileOf: (userId: UserId) => Promise<ProfileRecord | undefined>;
  /** Replaces the profile; a field left out is cleared. */
  setProfile: (userId: UserId, profile: ProfileRecord) => Promise<void>;
  /** The saved addresses, the default first, then oldest first. */
  addresses: (userId: UserId) => Promise<readonly SavedAddress[]>;
  /** Adds an address unless the account already holds `max`; the first one becomes the default. */
  addAddress: (userId: UserId, input: SavedAddressInput, max: number, now: Date) => Promise<AddAddressOutcome>;
  /** Resolves to whether the account has an address with `id`. */
  updateAddress: (userId: UserId, id: AddressId, input: SavedAddressInput, now: Date) => Promise<boolean>;
  /** Resolves to whether the account had an address with `id`. */
  removeAddress: (userId: UserId, id: AddressId) => Promise<boolean>;
}>;

export const AccountRepository = {
  /** What a saved address keeps sealed. */
  details: z.object({
    label: z.string(),
    fullName: z.string(),
    phone: z.string(),
    address: ShippingAddress.schema,
  }),

  create: (db: Database, cipher: FieldCipher): AccountRepository => {
    const sealed = (input: SavedAddressInput) =>
      cipher.seal({ label: input.label, fullName: input.fullName, phone: input.phone, address: input.address });

    /** Makes `id` the account's only default address. */
    const makeDefault = async (tx: Transaction, userId: UserId, id: AddressId): Promise<void> => {
      await tx.update(addresses).set({ isDefault: false }).where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
      await tx.update(addresses).set({ isDefault: true }).where(and(eq(addresses.userId, userId), eq(addresses.id, id)));
    };

    return {
      profileOf: async (userId) => {
        const [row] = await db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, userId));
        if (row === undefined) return undefined;

        return {
          ...(row.fullName === null ? {} : { fullName: cipher.open(row.fullName, z.string()) }),
          ...(row.phone === null ? {} : { phone: cipher.open(row.phone, z.string()) }),
        };
      },

      setProfile: async (userId, profile) => {
        await db
          .update(users)
          .set({
            fullName: profile.fullName === undefined ? null : cipher.seal(profile.fullName),
            phone: profile.phone === undefined ? null : cipher.seal(profile.phone),
          })
          .where(eq(users.id, userId));
      },

      addresses: async (userId) => {
        const rows = await db
          .select({ id: addresses.id, details: addresses.details, isDefault: addresses.isDefault })
          .from(addresses)
          .where(eq(addresses.userId, userId))
          .orderBy(desc(addresses.isDefault), asc(addresses.createdAt), asc(addresses.id));

        return rows.map((row) => ({ id: row.id, ...cipher.open(row.details, AccountRepository.details), isDefault: row.isDefault }));
      },

      addAddress: (userId, input, max, now) =>
        db.transaction(async (tx): Promise<AddAddressOutcome> => {
          // Locking the account serializes two additions, so neither passes the limit.
          await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

          const [held] = await tx.select({ total: count() }).from(addresses).where(eq(addresses.userId, userId));
          const total = held?.total ?? 0;
          if (total >= max) return { _tag: "LimitReached" };

          const [created] = await tx
            .insert(addresses)
            .values({ userId, details: sealed(input), isDefault: false, createdAt: now, updatedAt: now })
            .returning({ id: addresses.id });
          if (created === undefined) throw new Error("address insert returned no row");

          if (input.isDefault || total === 0) await makeDefault(tx, userId, created.id);

          return { _tag: "Added", id: created.id };
        }),

      updateAddress: (userId, id, input, now) =>
        db.transaction(async (tx) => {
          const [updated] = await tx
            .update(addresses)
            .set({ details: sealed(input), updatedAt: now })
            .where(and(eq(addresses.userId, userId), eq(addresses.id, id)))
            .returning({ id: addresses.id });
          if (updated === undefined) return false;

          if (input.isDefault) await makeDefault(tx, userId, id);
          return true;
        }),

      removeAddress: async (userId, id) => {
        const removed = await db
          .delete(addresses)
          .where(and(eq(addresses.userId, userId), eq(addresses.id, id)))
          .returning({ id: addresses.id });

        return removed.length > 0;
      },
    };
  },
} as const;
