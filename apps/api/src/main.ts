/**
 * Process entrypoint: read the environment, open the database, serve, and
 * put both down cleanly when the orchestrator says stop.
 */

import { App } from "./app.ts";
import { Config } from "./config.ts";
import { Database } from "./db/client.ts";

const config = Config.load();
const database = Database.open(config.database.url, config.database.poolSize);
const app = await App.build({ config, database });

// Docker sends SIGTERM and waits; in-flight requests finish before the pool closes.
const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await database.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.http.host, port: config.http.port });

app.log.info({ captcha: config.captcha.mode, oauth: config.oauth.mode }, "Prism API ready");
