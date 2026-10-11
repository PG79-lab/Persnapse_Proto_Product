import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createVercelCommand,
  createVercelCurlEnvironment,
} from "./vercel-cli-environment.mjs";
import {
  assertAllDeploymentsProtected,
  inspectReviewedPreviewDeployment,
  readLinkedVercelProject,
} from "./vercel-project-guard.mjs";

const url = process.argv.find((a) => a.startsWith("--deployment="))?.slice(13);
const publicAccess = process.argv.includes("--public-access");
const link = readLinkedVercelProject("verify integrated Preview");
assertAllDeploymentsProtected(link, "verify integrated Preview");
const target = inspectReviewedPreviewDeployment(link, url);
const report = {
  checkedAt: new Date().toISOString(),
  target: target.url,
  access: publicAccess ? "public-domain-exception" : "protected",
  verified: false,
  steps: [],
};
mkdirSync("test-results", { recursive: true });
async function request(path) {
  if (publicAccess) {
    const response = await fetch(new URL(path, target.url), {
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    report.steps.push({ path, status: response.status, authenticated: false });
    assert.equal(response.status, 200);
    return response.text();
  }
  const command = createVercelCommand([
    "curl",
    path,
    "--deployment",
    target.url,
    "--",
    "--silent",
    "--show-error",
    "--max-time",
    "45",
    "--write-out",
    "\\n__PERSNAPSE_STATUS__:%{http_code}",
  ]);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: process.cwd(),
    env: createVercelCurlEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 6 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(
      "Authenticated Preview request failed; response body withheld.",
    );
  const split = result.stdout.lastIndexOf("__PERSNAPSE_STATUS__:");
  assert(split >= 0, "HTTP status marker required");
  const status = Number(
    result.stdout.slice(split + "__PERSNAPSE_STATUS__:".length),
  );
  report.steps.push({ path, status });
  assert.equal(status, 200);
  return result.stdout.slice(0, split).trim();
}
try {
  const unauthenticated = await fetch(target.url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  report.unauthenticatedStatus = unauthenticated.status;
  if (publicAccess) {
    assert.equal(unauthenticated.status, 200);
  } else {
    assert(
      [301, 302, 303, 307, 308, 401, 403].includes(unauthenticated.status),
      "Preview must retain access protection",
    );
  }
  const html = await request("/");
  assert(html.includes("/_next/static/"));
  const payload = JSON.parse(await request("/api/workspace"));
  assert.equal(payload.capabilities.storage, "server");
  assert.equal(payload.capabilities.aiMode, "live");
  assert.equal(payload.capabilities.ocrMode, "live");
  assert(
    Array.isArray(payload.state.people) &&
      Array.isArray(payload.state.todos) &&
      Array.isArray(payload.state.meetings),
  );
  report.workspace = {
    people: payload.state.people.filter((p) => !p.deletedAt).length,
    meetings: payload.state.meetings.filter((m) => !m.deletedAt).length,
    todos: payload.state.todos.filter((t) => !t.deletedAt).length,
    capabilities: payload.capabilities,
  };
  const preparation = JSON.parse(await request("/api/recall/preparation"));
  report.searchPreparation = {
    ready: preparation.ready,
    total: preparation.total,
    prepared: preparation.prepared,
  };
  assert.equal(preparation.ready, true);
  report.verified = true;
} catch (error) {
  report.error =
    error instanceof Error ? error.message : "Preview verification failed";
  process.exitCode = 1;
} finally {
  const path = publicAccess
    ? "test-results/workspace-public-preview-verification.json"
    : "test-results/workspace-preview-verification.json";
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath: path }, null, 2));
}
