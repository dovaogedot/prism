/**
 * API integration tests for the migration runner.
 *
 * Each test gets an empty database of its own inside one Postgres container,
 * so what one test records cannot decide what another sees. The checksums the
 * runner should record are computed here from the raw bytes of each file,
 * independently of the runner.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
const connections: postgres.Sql[] = [];

/** Every migration file, in filename order, with the SHA-256 of its bytes. */
let files: readonly { name: string; checksum: string }[];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });

  const names = (await readdir(MIGRATIONS_DIR)).filter((entry) => entry.endsWith(".sql")).sort();
  files = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(join(MIGRATIONS_DIR, name)))
        .digest("hex"),
    })),
  );
}, 180_000);

afterAll(async () => {
  await Promise.all(connections.map((sql) => sql.end()));
  await admin.end();
  await container.stop();
});

/** A database no other test touches, with nothing in it. */
const emptyDatabase = async (): Promise<postgres.Sql> => {
  const name = `migrate_${connections.length + 1}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;

  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  connections.push(sql);
  return sql;
};

/** What the database records about its migrations, as plain rows. */
const recordedIn = async (sql: postgres.Sql) => [
  ...(await sql<{ name: string; checksum: string | null }[]>`
    SELECT name, checksum FROM schema_migration ORDER BY name
  `),
];

const names = () => files.map(({ name }) => name);

describe("runMigrations", () => {
  it("applies every file to an empty database, recording each with its checksum", async () => {
    const sql = await emptyDatabase();

    expect(await runMigrations(sql)).toEqual({ _tag: "Migrated", applied: names(), skipped: [] });
    expect(await recordedIn(sql)).toEqual(files);
  });

  it("applies nothing to a database already built from these files", async () => {
    const sql = await emptyDatabase();
    await runMigrations(sql);

    expect(await runMigrations(sql)).toEqual({ _tag: "Migrated", applied: [], skipped: names() });
  });

  it("refuses a database whose files read differently from when it applied them", async () => {
    const sql = await emptyDatabase();
    await runMigrations(sql);
    await sql`UPDATE schema_migration SET checksum = ${"0".repeat(64)}`;

    expect(await runMigrations(sql)).toEqual({
      _tag: "Refused",
      mismatches: names().map((name) => ({ _tag: "Edited", name })),
    });
  });

  it("refuses rows kept without a checksum, and applies none of the files after them", async () => {
    const sql = await emptyDatabase();
    const first = names().slice(0, 1);

    await sql`
      CREATE TABLE schema_migration (
        name       text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    for (const name of first) await sql`INSERT INTO schema_migration (name) VALUES (${name})`;

    expect(await runMigrations(sql)).toEqual({
      _tag: "Refused",
      mismatches: first.map((name) => ({ _tag: "Unverified", name })),
    });
    expect(await recordedIn(sql)).toEqual(first.map((name) => ({ name, checksum: null })));
  });

  it("holds no lock once it has refused", async () => {
    const sql = await emptyDatabase();
    await runMigrations(sql);
    await sql`UPDATE schema_migration SET checksum = NULL`;
    await runMigrations(sql);

    const locks = await admin<{ held: number }[]>`
      SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory'
    `;

    expect(locks.map(({ held }) => held)).toEqual([0]);
  });
});
