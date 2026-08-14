import { defineConfig } from "vitest/config";

/**
 * Two projects, because they have very different costs.
 *
 * `unit` touches nothing outside the process and finishes in milliseconds, so
 * it runs on every save. `integration` starts a real Postgres in a container
 * and is the slower gate before a commit.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          environment: "node",
          // Pulling and starting the Postgres image dominates the first run.
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // One container, one schema — parallel files would race on the data.
          fileParallelism: false,
        },
      },
    ],
  },
});
