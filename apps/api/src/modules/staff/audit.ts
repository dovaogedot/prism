/**
 * The audit log: what staff did, and what the system did on its own. A
 * change and its entry are written in one transaction, so neither exists
 * without the other, and the table itself refuses every UPDATE and DELETE.
 */

import { Email, Page, type AuditEventView, type AuditQuery, type StaffRole, type UserId } from "@prism/shared";
import { and, count, desc, eq, gte, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client.ts";
import { auditEvents, users } from "../../db/schema.ts";
import type { FieldCipher } from "../../platform/cipher.ts";

/** A staff member acting through the admin. */
export type StaffActor = Readonly<{ id: UserId; roles: readonly StaffRole[]; ip: string }>;

/** Who did something: a staff member, or the system. */
export type AuditActor = StaffActor | "system";

/** One entry, as the change it records describes it. */
export type AuditEntry = Readonly<{
  actor: AuditActor;
  /** What happened, as `<target type>.<verb>`, such as `product.update`. */
  action: string;
  target: Readonly<{ type: string; id?: string }>;
  /** One line a person reads. */
  summary: string;
  /** The fields that changed, as `[before, after]`. Never a personal value. */
  changes?: Readonly<Record<string, readonly [unknown, unknown]>>;
}>;

/** Writing entries, and reading them back a page at a time. */
export type AuditLog = Readonly<{
  /** Writes `entry` inside `tx`, so it commits exactly when the change does. */
  record: (tx: Transaction, entry: AuditEntry) => Promise<void>;
  list: (query: AuditQuery) => Promise<Page<AuditEventView>>;
}>;

export const AuditLog = {
  /**
   * The fields of `after` whose values differ from `before`, as
   * `{ field: [before, after] }`, or `undefined` when none does. Values are
   * compared as JSON, so arrays and objects compare by content.
   */
  diff: (
    before: Readonly<Record<string, unknown>>,
    after: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, readonly [unknown, unknown]>> | undefined => {
    const changes: Record<string, readonly [unknown, unknown]> = {};

    for (const [field, value] of Object.entries(after)) {
      if (JSON.stringify(before[field]) !== JSON.stringify(value)) changes[field] = [before[field] ?? null, value ?? null];
    }

    return Object.keys(changes).length === 0 ? undefined : changes;
  },

  changesSchema: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])),

  /** An exact action, or every action under a prefix that ends in a dot. */
  actionCondition: (action: string) =>
    action.endsWith(".")
      ? like(auditEvents.action, `${action.replace(/_/g, "\\_")}%`)
      : eq(auditEvents.action, action),

  create: (db: Database, cipher: FieldCipher): AuditLog => ({
    record: async (tx, entry) => {
      const actor = entry.actor === "system" ? undefined : entry.actor;

      await tx.insert(auditEvents).values({
        actorId: actor?.id ?? null,
        actorRoles: actor === undefined ? [] : [...actor.roles],
        action: entry.action,
        targetType: entry.target.type,
        targetId: entry.target.id ?? null,
        summary: entry.summary,
        changes: entry.changes ?? null,
        ip: actor === undefined ? null : cipher.seal(actor.ip),
      });
    },

    list: async (query) => {
      const conditions = and(
        query.actor === undefined ? undefined : eq(auditEvents.actorId, query.actor),
        query.action === undefined ? undefined : AuditLog.actionCondition(query.action),
        query.targetType === undefined ? undefined : eq(auditEvents.targetType, query.targetType),
        query.targetId === undefined ? undefined : eq(auditEvents.targetId, query.targetId),
        query.from === undefined
          ? undefined
          : gte(auditEvents.createdAt, sql`(${query.from}::date)::timestamp AT TIME ZONE 'UTC'`),
        // The end day counts, so the bound is the start of the next one.
        query.to === undefined
          ? undefined
          : lt(auditEvents.createdAt, sql`((${query.to}::date + 1)::timestamp) AT TIME ZONE 'UTC'`),
      );

      const [rows, totals] = await Promise.all([
        db
          .select({
            id: auditEvents.id,
            createdAt: auditEvents.createdAt,
            actorId: auditEvents.actorId,
            actorEmail: users.email,
            actorRoles: auditEvents.actorRoles,
            action: auditEvents.action,
            targetType: auditEvents.targetType,
            targetId: auditEvents.targetId,
            summary: auditEvents.summary,
            changes: auditEvents.changes,
            ip: auditEvents.ip,
          })
          .from(auditEvents)
          .leftJoin(users, eq(users.id, auditEvents.actorId))
          .where(conditions)
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(query.perPage)
          .offset((query.page - 1) * query.perPage),
        db.select({ total: count() }).from(auditEvents).where(conditions),
      ]);

      const total = totals[0]?.total ?? 0;

      return {
        items: rows.map((row): AuditEventView => {
          const changes = row.changes === null ? undefined : AuditLog.changesSchema.safeParse(row.changes);

          return {
            id: row.id,
            at: row.createdAt.toISOString(),
            ...(row.actorId === null || row.actorEmail === null
              ? {}
              : { actor: { id: row.actorId, email: cipher.open(row.actorEmail, Email.schema) } }),
            actorRoles: row.actorRoles,
            action: row.action,
            targetType: row.targetType,
            ...(row.targetId === null ? {} : { targetId: row.targetId }),
            summary: row.summary,
            ...(changes === undefined || !changes.success ? {} : { changes: changes.data }),
            ...(row.ip === null ? {} : { ip: cipher.open(row.ip, z.string()) }),
          };
        }),
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Page.count(total, query.perPage),
      };
    },
  }),
} as const;
