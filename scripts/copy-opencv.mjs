import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("@techstark/opencv-js");
const destination = join(process.cwd(), "public", "vendor", "opencv.js");
const licenseSource = join(dirname(source), "..", "LICENSE");
const licenseDestination = join(
  process.cwd(),
  "public",
  "vendor",
  "opencv-LICENSE.txt",
);

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
await copyFile(licenseSource, licenseDestination);
