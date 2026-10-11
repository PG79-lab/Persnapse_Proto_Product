import { previewEnvironmentPolicy } from "./vercel-preview-environment-policy.mjs";
const { expectedPreviewEnvironment } = previewEnvironmentPolicy(
  process.argv.includes("--live-assistant"),
  process.argv.includes("--openai-ocr"),
);
import {
  assertAllDeploymentsProtected,
  assertPreviewEnvironmentInventory,
  assertProjectHasDeploymentHistory,
  readLinkedVercelProject,
} from "./vercel-project-guard.mjs";

const link = readLinkedVercelProject("verify Preview readiness");
assertAllDeploymentsProtected(link, "verify Preview readiness");
assertProjectHasDeploymentHistory(link, "verify Preview readiness");
const environmentCount = assertPreviewEnvironmentInventory(
  link,
  expectedPreviewEnvironment,
  "verify Preview readiness",
);

console.log(
  JSON.stringify({
    protection: "all",
    productionHistory: "ready",
    previewEnvironmentCount: environmentCount,
    unknownEnvironmentVariables: 0,
  }),
);
