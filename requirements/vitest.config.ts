import { defineConfig } from "vitest/config"

/**
 * The requirement checks that need no browser: those that read the
 * repository's files, and those that drive the real API on a real Postgres
 * started through Testcontainers, so Docker has to be running. The checks a
 * browser has to make are `*.spec.ts`, which the browser suite runs.
 */
export default defineConfig({
  test: {
    include: ["part-*/**/*.test.ts"],
    environment: "node",
    // Pulling and starting the Postgres image dominates the first file.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // A file that starts the API starts its own container.
    fileParallelism: false,
  },
})
