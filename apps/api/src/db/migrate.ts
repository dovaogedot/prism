/**
 * Applies the SQL under `drizzle/` that has not run yet. Run as a script it
 * migrates the database named by `DATABASE_URL`, then exits.
 */

import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Database, type Database as Db } from "./client.ts";

export const Migrations = {
  /** Where `drizzle-kit generate` writes the migration files. */
  folder: fileURLToPath(new URL("../../drizzle", import.meta.url)),

  /** Runs every migration the database has not seen, in order, each in its own transaction. */
  apply: (db: Db): Promise<void> => migrate(db, { migrationsFolder: Migrations.folder }),
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env["DATABASE_URL"];

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const database = Database.open(url, 1);
  await Migrations.apply(database.db);
  await database.close();
  process.stdout.write("Migrations applied.\n");
}
