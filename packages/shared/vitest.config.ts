import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live outside src/ so the published surface is only the library.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
