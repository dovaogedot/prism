import { defineConfig } from "vitest/config";

/** The web app's pure functions, which need nothing but Node. */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
