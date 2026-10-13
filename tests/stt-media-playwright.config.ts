import { resolve } from "node:path";
import configuration from "./stt-playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...configuration,
  testDir: "./stt-live",
  testMatch: ["recorded-audio.spec.ts", "realtime-recording.spec.ts"],
  timeout: 90_000,
  use: {
    ...configuration.use,
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${resolve(import.meta.dirname, "../output/stt-integration/jfk.wav")}`,
      ],
    },
  },
});
