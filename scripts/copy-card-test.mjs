import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public/card-test", { recursive: true });
await copyFile(
  "tests/fixtures/card_recognition/lab/sample.png",
  "public/card-test/sample.png",
);
