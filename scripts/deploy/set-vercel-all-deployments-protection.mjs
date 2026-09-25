import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createSanitizedVercelEnvironment,
  createVercelCommand,
} from "./vercel-cli-environment.mjs";

const linkFile = resolve(process.cwd(), ".vercel", "project.json");
let link;
try {
  link = JSON.parse(readFileSync(linkFile, "utf8"));
} catch {
  throw new Error("Vercel project is not linked; protection was not changed.");
}

if (!link.projectId || !link.orgId) {
  throw new Error(
    ".vercel/project.json does not contain a projectId and orgId; protection was not changed.",
  );
}

const confirmation = process.argv
  .find((argument) =>
    argument.startsWith("--confirm-all-deployments-protection="),
  )
  ?.split("=", 2)[1];

console.log(
  `[vercel-protection] destination project=${link.projectName ?? "unknown"} projectId=${link.projectId} orgId=${link.orgId}`,
);

const environment = createSanitizedVercelEnvironment();
const endpoint = `/v9/projects/${encodeURIComponent(link.projectId)}`;

function runVercel(arguments_, input) {
  const command = createVercelCommand(arguments_);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: process.cwd(),
    env: environment,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `Vercel command failed while managing deployment protection (exit ${result.status ?? "unknown"}).`,
    );
  }
  return result.stdout;
}

function readDeploymentType() {
  const output = runVercel(["api", endpoint, "--raw"]);
  try {
    return JSON.parse(output).ssoProtection?.deploymentType;
  } catch {
    throw new Error(
      "Vercel returned an unreadable project response; protection was not assumed.",
    );
  }
}

const before = readDeploymentType();
console.log(`[vercel-protection] current=${before ?? "disabled"}`);

if (before === "all") {
  console.log("[vercel-protection] All Deployments is already enabled.");
  process.exit(0);
}

if (confirmation !== link.projectId) {
  throw new Error(
    `DRY RUN ONLY. Rerun with --confirm-all-deployments-protection=${link.projectId} to protect Preview and Production URLs. No protection setting was changed.`,
  );
}

runVercel(
  ["api", endpoint, "--method", "PATCH", "--input", "-", "--silent"],
  JSON.stringify({ ssoProtection: { deploymentType: "all" } }),
);

const after = readDeploymentType();
if (after !== "all") {
  throw new Error(
    `All Deployments verification failed (observed ${after ?? "disabled"}).`,
  );
}

console.log("[vercel-protection] verified=all");
