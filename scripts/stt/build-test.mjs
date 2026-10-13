import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
if (!existsSync(resolve(root, "src/app/api/stt/transcribe/route.ts")))
  throw new Error("Run from the persnapse-mvp repository.");
const buildDir = resolve(root, `output/stt-integration/build-${Date.now()}`);
mkdirSync(buildDir, { recursive: true });
for (const directory of [
  "src",
  "scripts",
  "tests",
  "public",
  "card_recognition",
  "supabase",
])
  cpSync(resolve(root, directory), resolve(buildDir, directory), {
    recursive: true,
  });
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    (/\.(json|mjs|ts)$/.test(entry.name) ||
      [
        ".env.local",
        ".prettierignore",
        ".prettierrc",
        ".prettierrc.json",
        "AGENTS.md",
      ].includes(entry.name))
  )
    cpSync(resolve(root, entry.name), resolve(buildDir, entry.name));
}
symlinkSync(
  resolve(root, "node_modules"),
  resolve(buildDir, "node_modules"),
  "junction",
);
const configPath = resolve(buildDir, "next.config.ts");
const config = readFileSync(configPath, "utf8");
if (!config.includes("export default nextConfig;"))
  throw new Error(
    "Next config changed; review the isolated build configuration.",
  );
writeFileSync(
  configPath,
  config.replace(
    "export default nextConfig;",
    "nextConfig.experimental = { ...nextConfig.experimental, cpus: 1 };\nexport default nextConfig;",
  ),
);
for (const args of [
  ["scripts/copy-opencv.mjs"],
  ["scripts/copy-card-runtime.mjs"],
  ["scripts/copy-card-test.mjs"],
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: buildDir,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(
  resolve(root, "output/stt-integration/validation-path.txt"),
  buildDir,
);
console.log("Isolated STT build ready. Run START_STT_TEST.cmd.");
