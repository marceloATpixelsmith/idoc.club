import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LIVE_AUTH_BASE_URL;
if (baseURL !== "https://staging.idoc.club") {
  throw new Error("Live auth tests are restricted to https://staging.idoc.club.");
}

export default defineConfig({
  testDir: "./tests/live-auth",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: "test-results/live-auth",
  reporter: [["line"], ["./scripts/live-auth-reporter.mjs"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
