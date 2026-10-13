import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["stt-integration.spec.ts", "realtime-input.spec.ts"],
  outputDir: "../test-results/stt-integration",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    browserName: "chromium",
    channel: "msedge",
  },
  webServer: {
    cwd: resolve(import.meta.dirname, ".."),
    command: "node --import tsx scripts/stt/serve-test.ts",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: !process.env.CI,
  },
});
