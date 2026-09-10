/**
 * Migration runner.
 *
 * Each `.sql` file applies inside one transaction alongside the row recording
 * that it applied. Postgres has transactional DDL, so a migration that fails
 * halfway leaves the schema exactly as it was — atomicity in the one place
 * where a partial result would be hardest to clean up by hand.
 *
 * The row also keeps a checksum of the file. Each migration is written against
 * the schema the files before it build, so the runner only moves a database
 * forward while every file it applied still reads exactly as it did. When one
 * does not, the runner applies nothing and names it: the schema is not the one
 * the code expects, and the way on is to build the database again from the
 * files.
 *
 * An advisory lock keeps two containers starting at once from racing.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { match } from "ts-pattern";
import { Option } from "@prism/shared";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Arbitrary but fixed: two runners must pick the same number to contend. */
const ADVISORY_LOCK_KEY = 8_314_159;

/** A migration file as it reads on disk. */
export type MigrationFile = Readonly<{
  name: string;
  statements: string;
  /** SHA-256 of `statements`, as lowercase hex. */
  checksum: string;
}>;

/** A migration the database records as applied. */
export type AppliedMigration = Readonly<{
  name: string;
  /** SHA-256 of the file as it read when it applied, or `None` where the row keeps none. */
  checksum: Option<string>;
}>;

/**
 * A recorded migration its file no longer matches.
 *
 * `Edited`: the file reads differently from when it applied. `Unverified`: the
 * row keeps no checksum, so a change cannot be ruled out.
 */
export type Mismatch = Readonly<{
  _tag: "Edited" | "Unverified";
  name: string;
}>;

/** What a run is to do, decided before it touches the schema. */
export type MigrationPlan =
  | Readonly<{
      _tag: "Apply";
      /** The files the database does not record, in the order they apply. */
      pending: readonly MigrationFile[];
      /** The names of the files it records. */
      skipped: readonly string[];
    }>
  | Readonly<{
      _tag: "Refuse";
      /** Every recorded migration its file no longer matches. */
      mismatches: readonly Mismatch[];
    }>;

/** What a run did. */
export type MigrationOutcome =
  | Readonly<{
      _tag: "Migrated";
      /** The names of the files this run applied, in the order it applied them. */
      applied: readonly string[];
      /** The names of the files the database already recorded. */
      skipped: readonly string[];
    }>
  | Readonly<{
      _tag: "Refused";
      /** Every recorded migration its file no longer matches. Nothing was applied. */
      mismatches: readonly Mismatch[];
    }>;

/** SHA-256 of a migration's statements, as lowercase hex. */
export const checksumOf = (statements: string): string =>
  createHash("sha256").update(statements).digest("hex");

/** How a recorded migration fails to match its file, or `None` when it does not fail. */
const mismatchOf =
  (onDisk: ReadonlyMap<string, MigrationFile>) =>
  (row: AppliedMigration): Option<Mismatch> => {
    const file = Option.fromNullable(onDisk.get(row.name));

    // A row with no file is a database ahead of these files, which is what a
    // rollback to an older image looks like. The files it does have still
    // have to match.
    if (Option.isNone(file)) return Option.none;
    if (Option.isNone(row.checksum)) {
      return Option.some<Mismatch>({ _tag: "Unverified", name: row.name });
    }

    return row.checksum.value === file.value.checksum
      ? Option.none
      : Option.some<Mismatch>({ _tag: "Edited", name: row.name });
  };

/**
 * Decides what a run applies, from the files on disk and the migrations the
 * database records.
 *
 * Applies every file the database does not record, in the order `files` lists
 * them. Refuses instead, naming each cause in the order `recorded` lists them,
 * when a recorded migration's file reads differently from when it applied, or
 * the row keeps no checksum to compare. A recorded migration with no file on
 * disk is left alone.
 */
export const planMigrations = (
  files: readonly MigrationFile[],
  recorded: readonly AppliedMigration[],
): MigrationPlan => {
  const onDisk = new Map(files.map((file): [string, MigrationFile] => [file.name, file]));
  const mismatches = Option.compact(recorded.map(mismatchOf(onDisk)));

  if (mismatches.length > 0) return { _tag: "Refuse", mismatches };

  const done = new Set(recorded.map((row) => row.name));

  return {
    _tag: "Apply",
    pending: files.filter((file) => !done.has(file.name)),
    skipped: files.filter((file) => done.has(file.name)).map((file) => file.name),
  };
};

/** Every migration file on disk, in filename order. */
const readMigrations = async (): Promise<readonly MigrationFile[]> => {
  const entries = await readdir(MIGRATIONS_DIR);
  const names = entries.filter((entry) => entry.endsWith(".sql")).sort();

  return Promise.all(
    names.map(async (name) => {
      const statements = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      return { name, statements, checksum: checksumOf(statements) };
    }),
  );
};

/**
 * Brings the database up to the files on disk, or reports why it cannot.
 *
 * Applies every file the database does not record, in filename order, each in
 * its own transaction with the row that records it. When a recorded migration
 * no longer matches its file, applies nothing and returns the mismatches. The
 * whole run holds an advisory lock, so two runners starting at once do not
 * both apply the same file.
 */
export const runMigrations = async (sql: postgres.Sql): Promise<MigrationOutcome> => {
  await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum   text
    )
  `;
  // A table without the column gains it empty, and the plan refuses its rows
  // as unverified.
  await sql`ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS checksum text`;

  const rows = await sql<{ name: string; checksum: string | null }[]>`
    SELECT name, checksum FROM schema_migration ORDER BY name
  `;
  const recorded = rows.map((row) => ({
    name: row.name,
    checksum: Option.fromNullable(row.checksum),
  }));

  const outcome = await match(planMigrations(await readMigrations(), recorded))
    .with({ _tag: "Refuse" }, async ({ mismatches }): Promise<MigrationOutcome> => ({
      _tag: "Refused",
      mismatches,
    }))
    .with({ _tag: "Apply" }, async ({ pending, skipped }): Promise<MigrationOutcome> => {
      for (const file of pending) {
        await sql.begin(async (tx) => {
          await tx.unsafe(file.statements);
          await tx`
            INSERT INTO schema_migration (name, checksum) VALUES (${file.name}, ${file.checksum})
          `;
        });
      }

      return { _tag: "Migrated", applied: pending.map((file) => file.name), skipped };
    })
    .exhaustive();

  await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;

  return outcome;
};

/** What each kind of mismatch means, as the refusal prints it. */
const REASONS: Readonly<Record<Mismatch["_tag"], string>> = {
  Edited: "changed after it was applied",
  Unverified: "applied without a checksum, so a change cannot be ruled out",
};

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const url = process.env["DATABASE_URL"];

  if (url === undefined || url.length === 0) {
    process.stderr.write("DATABASE_URL is required.\n");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const outcome = await runMigrations(sql);
  await sql.end();

  match(outcome)
    .with({ _tag: "Migrated" }, ({ applied, skipped }) => {
      for (const name of skipped) process.stdout.write(`  already applied  ${name}\n`);
      for (const name of applied) process.stdout.write(`  applied          ${name}\n`);

      process.stdout.write(
        applied.length === 0
          ? "Schema is up to date.\n"
          : `Applied ${applied.length} migration(s).\n`,
      );
    })
    .with({ _tag: "Refused" }, ({ mismatches }) => {
      const width = Math.max(...mismatches.map(({ name }) => name.length));

      process.stderr.write(
        [
          "Refusing to migrate. What this database recorded does not match the files:",
          "",
          ...mismatches.map(({ _tag, name }) => `  ${name.padEnd(width)}  ${REASONS[_tag]}`),
          "",
          "Nothing was applied. The code expects the schema these files build, so the",
          "database has to be built again from them. That deletes everything the seed",
          "does not create:",
          "",
          "  local stack  ./start.sh reset, then ./start.sh",
          '  server       run the Deploy workflow by hand with "Rebuild the database" ticked',
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
    })
    .exhaustive();
}
