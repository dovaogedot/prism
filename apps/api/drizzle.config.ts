import { defineConfig } from "drizzle-kit";

/** `npx drizzle-kit generate` writes the SQL for a schema change under `drizzle/`. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
