/**
 * Process entrypoint: read the environment, open the database, serve, run
 * the background jobs, and put everything down cleanly when the
 * orchestrator says stop.
 */

import { App } from "./app.ts";
import { Config } from "./config.ts";
import { Database } from "./db/client.ts";

const config = Config.load();
const database = Database.open(config.database.url, config.database.poolSize);
const { app, jobs } = await App.build({ config, database });

// Docker sends SIGTERM and waits. The jobs stop first, then in-flight
// requests finish and the queue closes, and the pool closes last.
const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await jobs.stop();
  await app.close();
  await database.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.http.host, port: config.http.port });
jobs.start();

app.log.info(
  {
    captcha: config.captcha.mode,
    oauth: config.oauth.mode,
    payments: config.payments.mode,
    addressLookup: config.addressLookup.mode,
  },
  "Prism API ready",
);
