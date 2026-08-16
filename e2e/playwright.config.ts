import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real stack through a real browser.
 *
 * They deliberately do not start the app: `./start.sh` owns that, and pointing
 * these at whatever is already running keeps one definition of how the system
 * boots. `BASE_URL` lets the same specs run against a deployed instance.
 */
const baseURL = process.env["BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./.results",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: process.env["CI"] !== undefined ? 2 : 0,
  reporter: process.env["CI"] !== undefined ? "github" : [["list"]],

  expect: {
    // Layout-stability assertions compare screenshots; a couple of pixels of
    // font rendering drift should not fail a run.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Deterministic viewport: the filter rail's layout depends on it.
    viewport: { width: 1280, height: 900 },
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
