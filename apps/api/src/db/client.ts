/**
 * The database connection, built once at the composition root and injected
 * everywhere else. Nothing below this file reaches for a global.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.ts";

export type Sql = ReturnType<typeof postgres>;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseHandle = Readonly<{
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}>;

export const createDatabase = (
  url: string,
  poolSize: number,
): DatabaseHandle => {
  const sql = postgres(url, {
    max: poolSize,
    // Notices are Postgres talking to itself; the application log is not the
    // place for "table already exists, skipping".
    onnotice: () => {},
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
};
