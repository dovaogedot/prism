/**
 * Migration runner.
 *
 * Each `.sql` file applies inside one transaction alongside the row recording
 * that it applied. Postgres has transactional DDL, so a migration that fails
 * halfway leaves the schema exactly as it was — atomicity in the one place
 * where a partial result would be hardest to clean up by hand.
 *
 * An advisory lock keeps two containers starting at once from racing.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Arbitrary but fixed: two runners must pick the same number to contend. */
const ADVISORY_LOCK_KEY = 8_314_159;

/** Which files this run applied, and which it found already applied. */
export type MigrationReport = Readonly<{
  applied: readonly string[];
  skipped: readonly string[];
}>;

const listMigrations = async (): Promise<readonly string[]> => {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((entry) => entry.endsWith(".sql")).sort();
};

/**
 * Applies every file not yet recorded, in filename order.
 *
 * Each file runs inside its own transaction, and the whole run holds an
 * advisory lock, so two runners starting at once do not both apply the same
 * file.
 */
export const runMigrations = async (sql: postgres.Sql): Promise<MigrationReport> => {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;

  const applied: string[] = [];
  const skipped: string[] = [];

  const alreadyApplied = await sql<{ name: string }[]>`SELECT name FROM schema_migration`;
  const done = new Set(alreadyApplied.map((row) => row.name));

  for (const name of await listMigrations()) {
    if (done.has(name)) {
      skipped.push(name);
      continue;
    }

    const statements = await readFile(join(MIGRATIONS_DIR, name), "utf8");

    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`INSERT INTO schema_migration (name) VALUES (${name})`;
    });

    applied.push(name);
  }

  await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;

  return { applied, skipped };
};

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const url = process.env["DATABASE_URL"];

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const report = await runMigrations(sql);
  await sql.end();

  for (const name of report.skipped) process.stdout.write(`  already applied  ${name}\n`);
  for (const name of report.applied) process.stdout.write(`  applied          ${name}\n`);

  process.stdout.write(
    report.applied.length === 0
      ? "Schema is up to date.\n"
      : `Applied ${report.applied.length} migration(s).\n`,
  );
}
