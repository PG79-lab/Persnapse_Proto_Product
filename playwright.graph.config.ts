import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "4315");
if (!Number.isInteger(port) || port < 1024 || port > 65533)
  throw new Error("Invalid isolated test port");
const baseURL = `http://127.0.0.1:${port}`;
const validationPort = port + 2;
const validationURL = `http://127.0.0.1:${validationPort}`;
const rawValidation = /real STT gateway accepts same-origin browser uploads/;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/frontend-graph",
  fullyParallel: true,
  workers: 2,
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
  webServer: [
    {
      command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      env: {
        PERSNAPSE_GRAPH_PREVIEW: "1",
        AI_ROUTING_MODE: "mock",
        BUSINESS_CARD_OCR_MODE: "mock",
      },
    },
    {
      command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${validationPort}`,
      url: validationURL,
      reuseExistingServer: false,
      // Malformed-upload regression reaches the real validation handler.
      // Synthetic required env reaches validation; the unsupported model rejects
      // valid input before any provider fetch. Browser workspace reads are mocked.
      env: {
        PERSNAPSE_GRAPH_PREVIEW: "0",
        DATABASE_URL: "postgresql://disabled:disabled@127.0.0.1:1/disabled",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "validation-only",
        APP_DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
        OPENAI_API_KEY: "validation-only-not-a-provider-key",
        OPENAI_TRANSCRIPTION_MODEL: "disabled-for-validation",
        SUPABASE_SECRET_KEY: "",
        AI_ROUTING_MODE: "mock",
        BUSINESS_CARD_OCR_MODE: "mock",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      grepInvert: rawValidation,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "stt-validation",
      testMatch: "stt-integration.spec.ts",
      grep: rawValidation,
      use: { ...devices["Desktop Chrome"], baseURL: validationURL },
    },
  ],
});
