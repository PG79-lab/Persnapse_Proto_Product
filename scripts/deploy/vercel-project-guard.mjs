import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createSanitizedVercelEnvironment,
  createVercelCommand,
} from "./vercel-cli-environment.mjs";

export function readLinkedVercelProject(
  action = "continue with the Vercel operation",
) {
  const linkFile = resolve(process.cwd(), ".vercel", "project.json");
  let link;
  try {
    link = JSON.parse(readFileSync(linkFile, "utf8"));
  } catch {
    throw new Error(`Vercel project is not linked; cannot ${action}.`);
  }

  if (!link.projectId || !link.orgId) {
    throw new Error(
      `.vercel/project.json does not contain a projectId and orgId; cannot ${action}.`,
    );
  }

  return link;
}

function readVercelJson(endpoint, action) {
  const command = createVercelCommand(["api", endpoint, "--raw"]);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: process.cwd(),
    env: createSanitizedVercelEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `Vercel API verification failed while trying to ${action}; no protected operation was started.`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Vercel returned an unreadable response while trying to ${action}; no protected operation was started.`,
    );
  }
}

export function assertAllDeploymentsProtected(link, action) {
  const project = readVercelJson(
    `/v9/projects/${encodeURIComponent(link.projectId)}`,
    action,
  );
  validateVercelProjectProtection(link, project, action);
}

export function validateVercelProjectProtection(link, project, action) {
  if (project.id !== link.projectId || project.accountId !== link.orgId) {
    throw new Error(
      `Vercel returned a project outside the linked project or team; cannot ${action}.`,
    );
  }
  if (project.ssoProtection?.deploymentType !== "all") {
    throw new Error(
      `All Deployments protection is not active on the linked project; cannot ${action}.`,
    );
  }
}

export function assertProjectHasDeploymentHistory(link, action) {
  const history = readVercelJson(
    `/v6/deployments?projectId=${encodeURIComponent(link.projectId)}&limit=20`,
    action,
  );
  validateProductionDeploymentHistory(history, action);
}

export function validateProductionDeploymentHistory(history, action) {
  const hasReadyProduction = history.deployments?.some(
    (deployment) =>
      deployment.target === "production" && deployment.readyState === "READY",
  );
  if (!hasReadyProduction) {
    throw new Error(
      `The linked project has no READY Production deployment history; cannot ${action} because Vercel may treat the first deployment as Production.`,
    );
  }
}

export function inspectReviewedPreviewDeployment(link, deploymentUrl) {
  let url;
  try {
    url = new URL(deploymentUrl);
  } catch {
    throw new Error("The reviewed Preview deployment URL is invalid.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(url.hostname)
  ) {
    throw new Error(
      "The reviewed deployment must be an exact https://*.vercel.app root URL.",
    );
  }

  const deployment = readVercelJson(
    `/v13/deployments/${encodeURIComponent(url.hostname)}`,
    "verify the paid Preview smoke-test target",
  );
  return validateReviewedPreviewDeployment(link, url, deployment);
}

export function validateReviewedPreviewDeployment(
  link,
  deploymentUrl,
  deployment,
) {
  const url =
    deploymentUrl instanceof URL ? deploymentUrl : new URL(deploymentUrl);
  if (
    deployment.projectId !== link.projectId ||
    deployment.url !== url.hostname
  ) {
    throw new Error(
      "The reviewed deployment does not belong to the linked Vercel project.",
    );
  }
  if (deployment.readyState !== "READY") {
    throw new Error(
      `The reviewed Preview is not READY (observed ${deployment.readyState ?? "unknown"}).`,
    );
  }
  if (deployment.target !== null && deployment.target !== "preview") {
    throw new Error(
      `The reviewed deployment is not a Preview target (observed ${deployment.target ?? "unknown"}).`,
    );
  }

  return {
    id: deployment.id,
    url: `https://${deployment.url}`,
  };
}

export function assertPreviewEnvironmentInventory(link, expected, action) {
  const inventory = readVercelJson(
    `/v10/projects/${encodeURIComponent(link.projectId)}/env`,
    action,
  );
  validatePreviewEnvironmentInventory(inventory, expected);
  return expected.length;
}

export function validatePreviewEnvironmentInventory(inventory, expected) {
  if (!Array.isArray(inventory.envs)) {
    throw new Error("Vercel returned an unreadable environment inventory.");
  }

  const expectedByName = new Map(
    expected.map(({ name, type }) => [name, type]),
  );
  const observedNames = new Set();

  for (const entry of inventory.envs) {
    const targets = Array.isArray(entry.target)
      ? entry.target
      : [entry.target].filter(Boolean);
    if (
      observedNames.has(entry.key) ||
      !expectedByName.has(entry.key) ||
      targets.length !== 1 ||
      targets[0] !== "preview" ||
      entry.type !== expectedByName.get(entry.key)
    ) {
      throw new Error(
        `Vercel environment inventory is outside the reviewed Preview allowlist (entry=${entry.key ?? "unknown"}). Do not deploy until it is reviewed.`,
      );
    }
    observedNames.add(entry.key);
  }

  const missing = [...expectedByName.keys()].filter(
    (name) => !observedNames.has(name),
  );
  if (missing.length > 0 || observedNames.size !== expectedByName.size) {
    throw new Error(
      `Vercel Preview environment inventory is incomplete (missing=${missing.join(", ") || "unknown"}). Do not deploy until synchronization is rerun.`,
    );
  }
}
