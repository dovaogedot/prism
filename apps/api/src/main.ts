/**
 * Process entrypoint: read the environment, open the database, start serving,
 * and put both down cleanly when the orchestrator says stop.
 */

import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./db/client.ts";

const config = loadConfig();
const database = createDatabase(config.database.url, config.database.poolSize);

const app = await buildApp({ config, database });

/**
 * Docker sends SIGTERM and waits. Finishing in-flight requests before closing
 * the pool is the difference between a rolling restart and a burst of 502s.
 */
const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");

  await app.close();
  await database.close();

  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.http.host, port: config.http.port });

app.log.info(
  {
    captcha: config.captcha.mode,
    oauth: config.oauth.mode,
    docs: `${config.http.webOrigin}/api/docs`,
  },
  "Prism API ready",
);
