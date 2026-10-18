import { copyFile, mkdir } from "node:fs/promises";
if (process.env.VERCEL) process.exit(0);
await mkdir("public/card-test", { recursive: true });
await copyFile(
  "tests/fixtures/card_recognition/lab/sample.png",
  "public/card-test/sample.png",
);
