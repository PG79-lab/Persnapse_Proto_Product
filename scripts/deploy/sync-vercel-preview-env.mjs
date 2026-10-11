import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createVercelCommand } from "./vercel-cli-environment.mjs";
import { previewEnvironmentPolicy } from "./vercel-preview-environment-policy.mjs";
const { expectedPreviewEnvironment, previewOverrides, previewVariables } =
  previewEnvironmentPolicy(
    process.argv.includes("--live-assistant"),
    process.argv.includes("--openai-ocr"),
  );
import {
  assertAllDeploymentsProtected,
  assertPreviewEnvironmentInventory,
} from "./vercel-project-guard.mjs";

const linkFile = resolve(process.cwd(), ".vercel", "project.json");
let link;
try {
  link = JSON.parse(readFileSync(linkFile, "utf8"));
} catch {
  throw new Error(
    "Vercel project is not linked. Run the reviewed login/link flow first; no values were uploaded.",
  );
}

if (!link.projectId || !link.orgId) {
  throw new Error(
    ".vercel/project.json does not contain a projectId and orgId; no values were uploaded.",
  );
}

const confirmationPrefix = "--confirm-sensitive-upload=";
const confirmation = process.argv
  .slice(2)
  .find((argument) => argument.startsWith(confirmationPrefix))
  ?.slice(confirmationPrefix.length);
const protectionConfirmed = process.argv.includes(
  "--confirm-vercel-authentication-enabled",
);

console.log(
  `[vercel-env] destination project=${link.projectName ?? "unknown"} projectId=${link.projectId} orgId=${link.orgId}`,
);
console.log(
  `[vercel-env] plan config=${previewVariables
    .filter(({ visibility }) => visibility === "config")
    .map(({ name }) => name)
    .join(", ")}`,
);
console.log(
  `[vercel-env] plan secret=${previewVariables
    .filter(({ visibility }) => visibility === "secret")
    .map(({ name }) => name)
    .join(", ")}`,
);
console.log(
  `[vercel-env] plan overrides=${Object.keys(previewOverrides).join(", ")}`,
);

if (confirmation !== link.projectId || !protectionConfirmed) {
  throw new Error(
    `DRY RUN ONLY. After independently verifying the destination and enabling Vercel Authentication, rerun with --confirm-sensitive-upload=${link.projectId} --confirm-vercel-authentication-enabled. No values were uploaded.`,
  );
}

assertAllDeploymentsProtected(link, "synchronize Preview environment values");
console.log("[vercel-env] verified protection=all");

const values = new Map();
for (const { name, visibility } of previewVariables) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in .env.local.`);
  }
  values.set(name, { value, visibility });
}
for (const [name, value] of Object.entries(previewOverrides)) {
  values.set(name, { value, visibility: "config" });
}

const childEnvironment = { ...process.env };
for (const name of [
  ...previewVariables.map(({ name }) => name),
  ...Object.keys(previewOverrides),
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_OIDC_TOKEN",
]) {
  delete childEnvironment[name];
}
delete childEnvironment.VERCEL_TELEMETRY_DEBUG;
childEnvironment.VERCEL_TELEMETRY_DISABLED = "1";

for (const [name, { value, visibility }] of values) {
  const command = createVercelCommand([
    "env",
    "add",
    name,
    "preview",
    "--force",
    "--type",
    visibility,
    "--yes",
  ]);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: process.cwd(),
    env: childEnvironment,
    input: `${value}\n`,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to sync ${name} to Vercel Preview. The sequential update may now be partial; do not deploy until the sync is rerun and inventory verification succeeds.`,
    );
  }
  console.log(`[vercel-env] ${name}: synced`);
}

const verifiedCount = assertPreviewEnvironmentInventory(
  link,
  expectedPreviewEnvironment,
  "verify the synchronized Preview environment inventory",
);
console.log(
  `[vercel-env] verified inventory=${verifiedCount} target=preview unknown=0`,
);
