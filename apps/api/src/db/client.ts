/**
 * The database connection, opened once at the composition root and injected
 * everywhere else.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.ts";

/** The query builder, typed against this schema. */
export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** The query builder inside `db.transaction`, where every statement shares one commit. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The driver, for the statements the builder cannot express. */
export type Sql = ReturnType<typeof postgres>;

/** Both ways into the database, and the one way to shut them. */
export type DatabaseHandle = Readonly<{
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}>;

export const Database = {
  /** Opens a pool of at most `poolSize` connections. */
  open: (url: string, poolSize: number): DatabaseHandle => {
    const sql = postgres(url, {
      max: poolSize,
      // Notices are Postgres talking to itself, not application log lines.
      onnotice: () => {},
      // Every statement here is short: compiling one with JIT costs more than running it.
      connection: { jit: "off" },
    });

    return {
      db: drizzle(sql, { schema }),
      sql,
      close: () => sql.end({ timeout: 5 }),
    };
  },
} as const;
