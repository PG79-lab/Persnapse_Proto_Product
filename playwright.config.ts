import { defineConfig, devices } from "@playwright/test";
import { isolatedEnvironment } from "./scripts/testing/environment.mjs";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "3000");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/graph-visual.spec.ts",
  grepInvert: /@integration/,
  workers: 1,
  outputDir: "test-results/playwright",
  fullyParallel: true,
  timeout: 20_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: isolatedEnvironment,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],
});
