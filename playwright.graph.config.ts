import { defineConfig, devices } from "@playwright/test";
import { isolatedEnvironment } from "./scripts/testing/environment.mjs";
const port = Number(process.env.PLAYWRIGHT_GRAPH_PORT ?? "4315");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid isolated test port");
const baseURL = "http://127.0.0.1:" + port;
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "graph-visual.spec.ts",
  outputDir: "test-results/frontend-graph",
  workers: 1,
  timeout: 30000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port " +
      port,
    url: baseURL,
    reuseExistingServer: false,
    env: { ...isolatedEnvironment, PERSNAPSE_GRAPH_PREVIEW: "1" },
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
