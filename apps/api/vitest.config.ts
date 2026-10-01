import { defineConfig } from "vitest/config";

/**
 * Four projects, split by what they cost to run and what they prove.
 *
 * `unit` touches nothing outside the process and finishes in under a second,
 * so it runs on every save. `integration`, `security` and `flows` each start
 * a real Postgres in a container and are the slower gate before a commit;
 * `flows` walks whole customer journeys through the API. CI runs all four
 * before every deploy.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "seed/tests/**/*.test.ts"],
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
      {
        test: {
          name: "flows",
          include: ["tests/flows/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
