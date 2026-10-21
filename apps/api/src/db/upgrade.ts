/**
 * The step that seals the plain-text identity columns of a database created
 * before they were encrypted. The migration renames each such column to
 * `legacy_<name>` and adds its sealed replacement beside it; this step seals
 * every value into the replacement, computes the blind indexes, drops the
 * legacy columns, and adds the constraints that had to wait for the values.
 * It runs in the migration's transaction, so a failure anywhere leaves the
 * database as it was. On a database without legacy columns it does nothing.
 */

import { Contact, Email } from "@prism/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FieldCipher } from "../platform/cipher.ts";
import { ProviderSubject } from "../platform/oauth.ts";
import { TotpSecret } from "../platform/totp.ts";
import type { Transaction } from "./client.ts";

export const Upgrade = {
  /** The tables this step deletes plain text from, which a rewrite then clears from disk. */
  CLEARED_TABLES: ["app_user", "oauth_identity", "session"] as const,

  /** The legacy rows, checked on the way out of the driver. */
  accountRow: z.object({ id: z.uuid(), legacy_email: z.string(), legacy_totp_secret: z.string().nullable() }),
  identityRow: z.object({ id: z.uuid(), legacy_subject: z.string() }),
  sessionRow: z.object({ id: z.uuid(), legacy_user_agent: z.string().nullable(), legacy_ip_address: z.string().nullable() }),
  orderRow: z.object({ id: z.uuid(), contact: z.instanceof(Buffer) }),

  /** Whether the legacy columns are still there. */
  isPending: async (tx: Transaction): Promise<boolean> => {
    const rows = await tx.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'app_user' AND column_name = 'legacy_email'`);

    return rows.length > 0;
  },

  /** A legacy session column held "" for a request that sent none; the sealed column holds null. */
  sealedOrNull: (cipher: FieldCipher, value: string | null): Buffer | null =>
    value === null || value.length === 0 ? null : cipher.seal(value),

  /**
   * Seals every legacy value, deletes the plain text and finishes the schema.
   * Each UPDATE sets the legacy value to null in the same statement, so no
   * new row version carries it. Resolves to whether there was anything to do.
   */
  sealLegacyColumns: async (tx: Transaction, cipher: FieldCipher): Promise<boolean> => {
    if (!(await Upgrade.isPending(tx))) return false;

    for (const raw of await tx.execute(sql`SELECT id, legacy_email, legacy_totp_secret FROM app_user`)) {
      const account = Upgrade.accountRow.parse(raw);
      const email = Email.schema.parse(account.legacy_email);
      const secret =
        account.legacy_totp_secret === null ? null : cipher.seal(TotpSecret.schema.parse(account.legacy_totp_secret));

      await tx.execute(sql`
        UPDATE app_user SET
          email = ${cipher.seal(email)},
          email_index = ${cipher.index("account-email", email)},
          totp_secret = ${secret},
          legacy_email = NULL,
          legacy_totp_secret = NULL
        WHERE id = ${account.id}`);
    }

    for (const raw of await tx.execute(sql`SELECT id, legacy_subject FROM oauth_identity`)) {
      const identity = Upgrade.identityRow.parse(raw);
      const subject = ProviderSubject.schema.parse(identity.legacy_subject);

      await tx.execute(sql`
        UPDATE oauth_identity SET
          subject = ${cipher.seal(subject)},
          subject_index = ${cipher.index("oauth-subject", subject)},
          legacy_subject = NULL
        WHERE id = ${identity.id}`);
    }

    for (const raw of await tx.execute(sql`SELECT id, legacy_user_agent, legacy_ip_address FROM session`)) {
      const session = Upgrade.sessionRow.parse(raw);

      await tx.execute(sql`
        UPDATE session SET
          user_agent = ${Upgrade.sealedOrNull(cipher, session.legacy_user_agent)},
          ip_address = ${Upgrade.sealedOrNull(cipher, session.legacy_ip_address)},
          legacy_user_agent = NULL,
          legacy_ip_address = NULL
        WHERE id = ${session.id}`);
    }

    // The order's contact was sealed already; its email gains the index staff search by.
    for (const raw of await tx.execute(sql`SELECT id, contact FROM customer_order`)) {
      const order = Upgrade.orderRow.parse(raw);
      const contact = cipher.open(order.contact, Contact.schema);

      await tx.execute(
        sql`UPDATE customer_order SET email_index = ${cipher.index("order-email", contact.email)} WHERE id = ${order.id}`,
      );
    }

    await tx.execute(sql`
      ALTER TABLE app_user
        DROP COLUMN legacy_email,
        DROP COLUMN legacy_totp_secret,
        ALTER COLUMN email SET NOT NULL,
        ALTER COLUMN email_index SET NOT NULL,
        ADD CONSTRAINT app_user_totp_needs_secret CHECK (totp_enabled_at IS NULL OR totp_secret IS NOT NULL)`);
    await tx.execute(sql`
      ALTER TABLE oauth_identity
        DROP COLUMN legacy_subject,
        ALTER COLUMN subject SET NOT NULL,
        ALTER COLUMN subject_index SET NOT NULL`);
    await tx.execute(sql`ALTER TABLE session DROP COLUMN legacy_user_agent, DROP COLUMN legacy_ip_address`);
    await tx.execute(sql`ALTER TABLE customer_order ALTER COLUMN email_index SET NOT NULL`);

    return true;
  },
} as const;
