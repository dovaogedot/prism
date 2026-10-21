/**
 * The delivery options. Checkout offers the active ones, in order; delivery
 * managers create, edit, deactivate and delete them. An order keeps its own
 * copy of what it was charged, so editing an option leaves placed orders as
 * they were, and an option that orders use cannot be deleted.
 */

import type {
  DomainError,
  ShippingMethodCode,
  ShippingMethodInput,
  ShippingMethodView,
  ShippingOption,
} from "@prism/shared";
import { asc, count, eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Database } from "../../db/client.ts";
import { orders, shippingMethods } from "../../db/schema.ts";
import type { Clock } from "../../platform/clock.ts";
import { AuthRepository } from "../auth/repository.ts";
import { AuditLog, type StaffActor } from "../staff/audit.ts";

/** Every read and write of the delivery options. */
export type ShippingMethods = Readonly<{
  /** The options checkout offers, in their order. */
  active: () => Promise<readonly ShippingOption[]>;
  /** The active option with `code`, or `undefined`. */
  findActive: (code: ShippingMethodCode) => Promise<ShippingOption | undefined>;
  /** Every option, inactive ones included, with how many orders used each. */
  all: () => Promise<readonly ShippingMethodView[]>;
  create: (actor: StaffActor, input: ShippingMethodInput) => ResultAsync<ShippingMethodView, DomainError>;
  update: (actor: StaffActor, code: ShippingMethodCode, input: ShippingMethodInput) => ResultAsync<ShippingMethodView, DomainError>;
  remove: (actor: StaffActor, code: ShippingMethodCode) => ResultAsync<void, DomainError>;
}>;

/** A row as the reads return it. */
type MethodRow = typeof shippingMethods.$inferSelect;

export const ShippingMethods = {
  optionOf: (row: MethodRow): ShippingOption => ({
    code: row.code,
    name: row.name,
    priceCents: row.priceCents,
    ...(row.freeFromCents === null ? {} : { freeFromCents: row.freeFromCents }),
    minDays: row.minDays,
    maxDays: row.maxDays,
  }),

  /** The fields an audit entry compares, none of them personal. */
  auditedOf: (option: Readonly<{
    name: string;
    priceCents: number;
    freeFromCents?: number | undefined;
    minDays: number;
    maxDays: number;
    isActive: boolean;
    position: number;
  }>) => ({
    name: option.name,
    priceCents: option.priceCents,
    freeFromCents: option.freeFromCents ?? null,
    minDays: option.minDays,
    maxDays: option.maxDays,
    isActive: option.isActive,
    position: option.position,
  }),

  create: (db: Database, audit: AuditLog, clock: Clock): ShippingMethods => {
    const viewOf = async (code: ShippingMethodCode): Promise<ShippingMethodView | undefined> => {
      const [row] = await db.select().from(shippingMethods).where(eq(shippingMethods.code, code));
      if (row === undefined) return undefined;

      const [used] = await db.select({ total: count() }).from(orders).where(eq(orders.shippingMethod, code));

      return { ...ShippingMethods.optionOf(row), isActive: row.isActive, position: row.position, orderCount: used?.total ?? 0 };
    };

    const valuesOf = (input: ShippingMethodInput) => ({
      name: input.name,
      priceCents: input.priceCents,
      freeFromCents: input.freeFromCents ?? null,
      minDays: input.minDays,
      maxDays: input.maxDays,
      isActive: input.isActive,
      position: input.position,
    });

    const found = (code: ShippingMethodCode): ResultAsync<ShippingMethodView, DomainError> =>
      ResultAsync.fromSafePromise(viewOf(code)).andThen((view) =>
        view === undefined
          ? errAsync<ShippingMethodView, DomainError>({ _tag: "ShippingMethodNotFound" })
          : okAsync<ShippingMethodView, DomainError>(view),
      );

    return {
      active: async () =>
        (
          await db
            .select()
            .from(shippingMethods)
            .where(eq(shippingMethods.isActive, true))
            .orderBy(asc(shippingMethods.position), asc(shippingMethods.code))
        ).map(ShippingMethods.optionOf),

      findActive: async (code) => {
        const [row] = await db.select().from(shippingMethods).where(eq(shippingMethods.code, code));
        return row === undefined || !row.isActive ? undefined : ShippingMethods.optionOf(row);
      },

      all: async () => {
        const rows = await db
          .select()
          .from(shippingMethods)
          .orderBy(asc(shippingMethods.position), asc(shippingMethods.code));
        const used = await db
          .select({ code: orders.shippingMethod, total: count() })
          .from(orders)
          .groupBy(orders.shippingMethod);
        const counts = new Map(used.map((row) => [row.code, row.total]));

        return rows.map((row) => ({
          ...ShippingMethods.optionOf(row),
          isActive: row.isActive,
          position: row.position,
          orderCount: counts.get(row.code) ?? 0,
        }));
      },

      create: (actor, input) =>
        ResultAsync.fromPromise(
          db.transaction(async (tx) => {
            await tx.insert(shippingMethods).values({ code: input.code, ...valuesOf(input) });
            await audit.record(tx, {
              actor,
              action: "shipping_method.create",
              target: { type: "shipping_method", id: input.code },
              summary: `Created the delivery option ${input.name}`,
            });
          }),
          (reason): DomainError =>
            AuthRepository.isUniqueViolation(reason)
              ? { _tag: "ValidationFailed", issues: [{ path: "code", message: "Another delivery option uses this code." }] }
              : ShippingMethods.rethrow(reason),
        ).andThen(() => found(input.code)),

      update: (actor, code, input) => {
        if (input.code !== code) {
          return errAsync({ _tag: "ValidationFailed", issues: [{ path: "code", message: "A delivery option keeps its code." }] });
        }

        return found(code).andThen((before) =>
          ResultAsync.fromSafePromise(
            db.transaction(async (tx) => {
              await tx
                .update(shippingMethods)
                .set({ ...valuesOf(input), updatedAt: clock.now() })
                .where(eq(shippingMethods.code, code));

              const changes = AuditLog.diff(ShippingMethods.auditedOf(before), ShippingMethods.auditedOf(input));
              if (changes !== undefined) {
                await audit.record(tx, {
                  actor,
                  action: "shipping_method.update",
                  target: { type: "shipping_method", id: code },
                  summary: `Edited the delivery option ${input.name}`,
                  changes,
                });
              }
            }),
          ).andThen(() => found(code)),
        );
      },

      remove: (actor, code) =>
        found(code).andThen((before) => {
          if (before.orderCount > 0) return errAsync<void, DomainError>({ _tag: "ShippingMethodInUse" });

          return ResultAsync.fromPromise(
            db.transaction(async (tx) => {
              await tx.delete(shippingMethods).where(eq(shippingMethods.code, code));
              await audit.record(tx, {
                actor,
                action: "shipping_method.delete",
                target: { type: "shipping_method", id: code },
                summary: `Deleted the delivery option ${before.name}`,
              });
            }),
            // An order placed between the check and the delete holds the row.
            (reason): DomainError => (ShippingMethods.isForeignKeyViolation(reason) ? { _tag: "ShippingMethodInUse" } : ShippingMethods.rethrow(reason)),
          );
        }),
    };
  },

  /** Postgres foreign-key violation, read one level down from drizzle's wrapper. */
  isForeignKeyViolation: (reason: unknown): boolean => {
    const codeOf = (value: unknown): unknown =>
      typeof value === "object" && value !== null && "code" in value ? value.code : undefined;

    return (
      codeOf(reason) === "23503" ||
      (typeof reason === "object" && reason !== null && "cause" in reason && codeOf(reason.cause) === "23503")
    );
  },

  /** Lets an unexpected database failure surface as the 500 it is, rather than a domain error. */
  rethrow: (reason: unknown): never => {
    throw reason;
  },
} as const;
