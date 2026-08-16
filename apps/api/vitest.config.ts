import { defineConfig } from "vitest/config";

/**
 * Three projects, split by what they cost to run.
 *
 * `unit` touches nothing outside the process and finishes in under a second,
 * so it runs on every save. `integration` and `security` each start a real
 * Postgres in a container and are the slower gate before a commit.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Pulling and starting the Postgres image dominates the first run.
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // One container per file, and the files share a schema.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "security",
          include: ["tests/security/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
