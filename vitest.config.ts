import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 1,
    environment: "jsdom",
    include: [
      "card_recognition/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "scripts/deploy/**/*.test.mjs",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
