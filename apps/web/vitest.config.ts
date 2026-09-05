import { defineConfig } from "vitest/config";

/**
 * The web app's arithmetic, and nothing else.
 *
 * Components are covered by Playwright against the real thing rather than by a
 * simulated DOM here. What runs in this project is the pure part — the lighting
 * model — which is plain functions and needs nothing but Node.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
