import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

import {
  createSanitizedVercelEnvironment,
  createVercelCommand,
} from "./vercel-cli-environment.mjs";

const workspace = realpathSync(process.cwd());
const linkFile = resolve(workspace, ".vercel", "project.json");
let link;
try {
  link = JSON.parse(readFileSync(linkFile, "utf8"));
} catch {
  throw new Error("Vercel project is not linked; bootstrap was not created.");
}

if (!link.projectId || !link.orgId) {
  throw new Error(
    ".vercel/project.json does not contain a projectId and orgId; bootstrap was not created.",
  );
}

const confirmation = process.argv
  .find((argument) => argument.startsWith("--confirm-bootstrap-production="))
  ?.split("=", 2)[1];
const protectionConfirmed = process.argv.includes(
  "--confirm-all-deployments-protection",
);

console.log(
  `[vercel-bootstrap] destination project=${link.projectName ?? "unknown"} projectId=${link.projectId} orgId=${link.orgId}`,
);

if (confirmation !== link.projectId || !protectionConfirmed) {
  throw new Error(
    `DRY RUN ONLY. Rerun with --confirm-bootstrap-production=${link.projectId} --confirm-all-deployments-protection after verifying All Deployments. No deployment was created.`,
  );
}

const environment = createSanitizedVercelEnvironment();
const projectEndpoint = `/v9/projects/${encodeURIComponent(link.projectId)}`;
const deploymentsEndpoint = `/v6/deployments?projectId=${encodeURIComponent(link.projectId)}&limit=20`;

function runVercel(arguments_, options = {}) {
  const command = createVercelCommand(arguments_);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: options.cwd ?? workspace,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
      .trim()
      .slice(-2000);
    throw new Error(
      `Vercel bootstrap command failed (exit ${result.status ?? "unknown"})${detail ? `: ${detail}` : "."}`,
    );
  }
  return result.stdout;
}

function readJson(endpoint) {
  const output = runVercel(["api", endpoint, "--raw"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      "Vercel returned an unreadable response; bootstrap stopped.",
    );
  }
}

const project = readJson(projectEndpoint);
if (project.ssoProtection?.deploymentType !== "all") {
  throw new Error(
    "All Deployments is not verified on the target project; bootstrap stopped.",
  );
}

const before = readJson(deploymentsEndpoint);
if ((before.deployments ?? []).length !== 0) {
  throw new Error(
    "The target project already has deployment history; bootstrap is neither needed nor allowed.",
  );
}

const temporaryDirectory = resolve(workspace, "tmp", "vercel-bootstrap");
const temporaryRelative = relative(workspace, temporaryDirectory);
if (
  !temporaryRelative ||
  temporaryRelative === ".." ||
  temporaryRelative.startsWith(`..${sep}`)
) {
  throw new Error("Refusing to create bootstrap files outside the workspace.");
}
if (existsSync(temporaryDirectory)) {
  throw new Error(
    `Refusing to overwrite the existing ${temporaryRelative} directory.`,
  );
}

let created = false;
try {
  const linkDirectory = resolve(temporaryDirectory, ".vercel");
  const outputDirectory = resolve(linkDirectory, "output");
  const staticDirectory = resolve(outputDirectory, "static");
  mkdirSync(staticDirectory, { recursive: true });
  created = true;

  writeFileSync(
    resolve(linkDirectory, "project.json"),
    `${JSON.stringify({
      orgId: link.orgId,
      projectId: link.projectId,
      projectName: link.projectName,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  writeFileSync(
    resolve(outputDirectory, "config.json"),
    `${JSON.stringify({ version: 3 })}\n`,
    "utf8",
  );
  writeFileSync(
    resolve(staticDirectory, "index.html"),
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Persnapse bootstrap</title></head><body><main><h1>Persnapse protected bootstrap</h1><p>This placeholder contains no application data or credentials.</p></main></body></html>\n',
    "utf8",
  );

  const generatedFiles = [];
  function inspectGenerated(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (lstatSync(path).isSymbolicLink()) {
        throw new Error("Bootstrap output must not contain symbolic links.");
      }
      if (entry.isDirectory()) {
        inspectGenerated(path);
      } else {
        generatedFiles.push(
          relative(temporaryDirectory, path).replaceAll("\\", "/"),
        );
      }
    }
  }
  inspectGenerated(temporaryDirectory);
  const expectedFiles = [
    ".vercel/output/config.json",
    ".vercel/output/static/index.html",
    ".vercel/project.json",
  ];
  generatedFiles.sort();
  if (JSON.stringify(generatedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Unexpected bootstrap output files: ${generatedFiles.join(", ")}`,
    );
  }

  runVercel(
    ["deploy", "--prebuilt", "--target=production", "--yes", "--archive=tgz"],
    { cwd: temporaryDirectory },
  );

  const after = readJson(deploymentsEndpoint);
  const deployments = after.deployments ?? [];
  if (deployments.length !== 1) {
    throw new Error(
      `Expected exactly one bootstrap deployment, observed ${deployments.length}.`,
    );
  }
  const deployment = deployments[0];
  if (deployment.target !== "production" || deployment.readyState !== "READY") {
    throw new Error(
      `Bootstrap verification failed (target=${deployment.target ?? "unknown"}, state=${deployment.readyState ?? "unknown"}).`,
    );
  }

  console.log(
    `[vercel-bootstrap] verified deploymentId=${deployment.uid ?? deployment.id ?? "unknown"} target=production state=READY url=https://${deployment.url}`,
  );
} finally {
  if (created && existsSync(temporaryDirectory)) {
    rmSync(temporaryDirectory, { recursive: true, force: false });
    console.log(
      `[vercel-bootstrap] removed temporary files: ${temporaryRelative}`,
    );
  }
}
