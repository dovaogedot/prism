/**
 * Applies the SQL under `drizzle/` that has not run yet, then the upgrade
 * step, in one transaction. Run as a script it migrates the database named
 * by `DATABASE_URL`, sealing with `DATA_ENCRYPTION_KEY`, then exits.
 */

import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
import { EncryptionKey, FieldCipher } from "../platform/cipher.ts";
import { Database, type Database as Db } from "./client.ts";
import { Upgrade } from "./upgrade.ts";

export const Migrations = {
  /** Where `drizzle-kit generate` writes the migration files. */
  folder: fileURLToPath(new URL("../../drizzle", import.meta.url)),

  /** Serializes two migrators started at once; the number only has to be stable. */
  LOCK_KEY: 4_242_001,

  /**
   * Runs every migration the database has not seen, in order, and then the
   * upgrade step, all in one transaction: a failure anywhere leaves the
   * database as it was. The bookkeeping is drizzle's own table, so drizzle
   * and this runner agree on what has run. When the upgrade deleted plain
   * text, the tables it cleared are rewritten after the commit, which is
   * what takes the old values off the disk.
   */
  apply: async (db: Db, cipher: FieldCipher): Promise<void> => {
    const migrations = readMigrationFiles({ migrationsFolder: Migrations.folder });

    const upgraded = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${Migrations.LOCK_KEY})`);
      await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

      const [last] = await tx.execute(
        sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
      );
      const lastApplied = last === undefined ? undefined : Number(last["created_at"]);

      for (const migration of migrations) {
        if (lastApplied !== undefined && migration.folderMillis <= lastApplied) continue;

        for (const statement of migration.sql) await tx.execute(sql.raw(statement));
        await tx.execute(
          sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
        );
      }

      return Upgrade.sealLegacyColumns(tx, cipher);
    });

    // VACUUM cannot run inside a transaction, so it follows the commit.
    if (upgraded) await db.execute(sql.raw(`VACUUM FULL ${Upgrade.CLEARED_TABLES.join(", ")}`));
  },
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const environment = z
    .object({ DATABASE_URL: z.string().min(1, "DATABASE_URL is required."), DATA_ENCRYPTION_KEY: EncryptionKey.schema })
    .safeParse(process.env);

  if (!environment.success) {
    process.stderr.write(`${environment.error.issues.map((issue) => issue.message).join("\n")}\n`);
    process.exit(1);
  }

  const database = Database.open(environment.data.DATABASE_URL, 1);
  await Migrations.apply(database.db, FieldCipher.create(EncryptionKey.bytes(environment.data.DATA_ENCRYPTION_KEY)));
  await database.close();
  process.stdout.write("Migrations applied.\n");
}
