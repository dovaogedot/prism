/**
 * The database connection, built once at the composition root and injected
 * everywhere else. Nothing below this file reaches for a global.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.ts";

/** The driver, for the statements Drizzle's builder cannot express. */
export type Sql = ReturnType<typeof postgres>;

/** The query builder, typed against this schema. */
export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Both ways into the database, and the one way to shut them. */
export type DatabaseHandle = Readonly<{
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}>;

/** Opens a pool of at most `poolSize` connections. */
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
