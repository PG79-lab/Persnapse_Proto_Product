import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const secretNames = [
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "CLOVA_OCR_INVOKE_URL",
  "CLOVA_OCR_SECRET",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "VERCEL_OIDC_TOKEN",
];

const workspace = resolve(process.cwd());
const ignoredDirectories = new Set([".git", "node_modules"]);
const allowedSource = resolve(workspace, ".env.local");
const secrets = secretNames
  .map((name) => ({ name, value: process.env[name] }))
  .filter(({ value }) => value && value.length >= 8);
const matches = [];

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (path === allowedSource) {
      continue;
    }

    let contents;
    try {
      contents = readFileSync(path);
    } catch {
      continue;
    }

    for (const { name, value } of secrets) {
      if (contents.includes(Buffer.from(value))) {
        matches.push({ name, path: relative(workspace, path) });
      }
    }
  }
}

scan(workspace);

console.log(`[secret-residue] values_checked=${secrets.length}`);
console.log(`[secret-residue] matches_outside_env_local=${matches.length}`);
for (const match of matches) {
  console.error(`[secret-residue] ${match.name}: ${match.path}`);
}

if (matches.length > 0) {
  console.error(
    "[secret-residue] Generated files contain local secret copies. Clean the generated cache before deployment or sharing.",
  );
  process.exitCode = 1;
}
