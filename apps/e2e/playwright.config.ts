/**
 * The browser suite, run against a stack that is already up: the
 * `prism-e2e` project locally, and the commit's images in CI. Its address
 * comes from `E2E_BASE_URL`; the stack's certificate is self-signed.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Two at a time: the stack is small, and the admin's tests share one session.
  workers: 2,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "https://localhost:3200",
    ignoreHTTPSErrors: true,
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
});
