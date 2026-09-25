import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createVercelCommand } from "./vercel-cli-environment.mjs";
import { previewEnvironmentPolicy } from "./vercel-preview-environment-policy.mjs";
const { expectedPreviewEnvironment } = previewEnvironmentPolicy(
  process.argv.includes("--live-assistant"),
);
import {
  assertAllDeploymentsProtected,
  assertPreviewEnvironmentInventory,
  assertProjectHasDeploymentHistory,
} from "./vercel-project-guard.mjs";

const linkFile = resolve(process.cwd(), ".vercel", "project.json");

let link;
try {
  link = JSON.parse(readFileSync(linkFile, "utf8"));
} catch {
  throw new Error(
    "Vercel project is not linked. Run the reviewed login/link flow first; no deployment was created.",
  );
}

if (!link.projectId || !link.orgId) {
  throw new Error(
    ".vercel/project.json does not contain a projectId and orgId; no deployment was created.",
  );
}

const confirmationPrefix = "--confirm-preview-deploy=";
const confirmation = process.argv
  .slice(2)
  .find((argument) => argument.startsWith(confirmationPrefix))
  ?.slice(confirmationPrefix.length);
const protectionConfirmed = process.argv.includes(
  "--confirm-vercel-authentication-enabled",
);
const deploymentHistoryConfirmed = process.argv.includes(
  "--confirm-project-has-deployment-history",
);

console.log(
  `[vercel-deploy] destination project=${link.projectName ?? "unknown"} projectId=${link.projectId} orgId=${link.orgId}`,
);

if (
  confirmation !== link.projectId ||
  !protectionConfirmed ||
  !deploymentHistoryConfirmed
) {
  throw new Error(
    `DRY RUN ONLY. After independently verifying the destination, Vercel Authentication, and that the project already has deployment history, rerun with --confirm-preview-deploy=${link.projectId} --confirm-vercel-authentication-enabled --confirm-project-has-deployment-history. Vercel documents that a new project's first deployment is Production even without --prod. No deployment was created.`,
  );
}

assertAllDeploymentsProtected(link, "deploy the MVP Preview");
assertProjectHasDeploymentHistory(link, "deploy the MVP Preview");
const environmentCount = assertPreviewEnvironmentInventory(
  link,
  expectedPreviewEnvironment,
  "verify the Preview environment before deployment",
);
console.log(
  `[vercel-deploy] verified protection=all deploymentHistory=present previewEnvironment=${environmentCount}`,
);

function runRequired(executable, arguments_, options = {}) {
  const result = spawnSync(executable, arguments_, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${executable} ${arguments_.join(" ")} failed.`);
  }
}

runRequired(process.execPath, [
  "scripts/security/clean-local-secret-cache.mjs",
]);
runRequired(process.execPath, [
  "--env-file=.env.local",
  "scripts/security/audit-secret-residue.mjs",
]);

const childEnvironment = { ...process.env };
for (const name of [
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
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_OIDC_TOKEN",
]) {
  delete childEnvironment[name];
}
delete childEnvironment.VERCEL_TELEMETRY_DEBUG;
childEnvironment.VERCEL_TELEMETRY_DISABLED = "1";

const command = createVercelCommand(["deploy", "--target=preview", "--yes"]);
runRequired(command.executable, command.arguments, { env: childEnvironment });
