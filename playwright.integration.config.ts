import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PERSNAPSE_INTEGRATION_BASE_URL;
if (
  !baseURL ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)
) {
  throw new Error(
    "Set PERSNAPSE_INTEGRATION_BASE_URL to the local test server connected to a dedicated test workspace. See docs/handoff/TESTING.md.",
  );
}
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "realtime-input.spec.ts",
  grep: /@integration/,
  workers: 1,
  retries: 0,
  timeout: 30000,
  outputDir: "test-results/integration",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    trace: "retain-on-failure",
  },
});
