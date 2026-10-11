import "server-only";

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

import { createSyntheticBusinessCardImage } from "../ai/synthetic-business-card-image.ts";
import { discardBusinessCardCapture } from "../../src/server/application/business-card-service.ts";
import { closeDatabase, getDatabase } from "../../src/server/db/client.ts";
import {
  clovaBusinessCardProviderScope,
  openAiBusinessCardProviderScope,
} from "../../src/server/db/ocr-cost-guard-repository.ts";
import { getServerEnv } from "../../src/server/env.ts";
import { removeBusinessCardAssets } from "../../src/server/storage/business-card-storage.ts";
import {
  createVercelCurlEnvironment,
  createVercelCommand,
} from "./vercel-cli-environment.mjs";
import {
  assertAllDeploymentsProtected,
  inspectReviewedPreviewDeployment,
  readLinkedVercelProject,
} from "./vercel-project-guard.mjs";

const deploymentPrefix = "--deployment=";
const deployment = process.argv
  .find((argument) => argument.startsWith(deploymentPrefix))
  ?.slice(deploymentPrefix.length);
const confirmationPrefix = "--confirm-live-ocr-once=";
const confirmedDeploymentId = process.argv
  .find((argument) => argument.startsWith(confirmationPrefix))
  ?.slice(confirmationPrefix.length);

if (!deployment || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(deployment)) {
  throw new Error(
    "A reviewed https://*.vercel.app deployment URL is required.",
  );
}
const workspace = realpathSync(process.cwd());
const link = readLinkedVercelProject(
  "verify the paid Preview smoke-test target",
);
assertAllDeploymentsProtected(
  link,
  "verify the paid Preview smoke-test target",
);
const reviewedDeployment = inspectReviewedPreviewDeployment(link, deployment);
if (confirmedDeploymentId !== reviewedDeployment.id) {
  throw new Error(
    `DRY RUN ONLY. After reviewing the immutable Preview target, rerun with --confirm-live-ocr-once=${reviewedDeployment.id}. No paid OCR request was made.`,
  );
}
console.log(
  `[preview-smoke] verified deploymentId=${reviewedDeployment.id} target=preview state=READY protection=all`,
);

const environment = getServerEnv();
const expectedProvider = environment.BUSINESS_CARD_OCR_PROVIDER;
const providerScope =
  expectedProvider === "openai"
    ? openAiBusinessCardProviderScope
    : clovaBusinessCardProviderScope;
const temporaryDirectory = resolve(workspace, "tmp", "vercel-preview-smoke");
const temporaryRelative = relative(workspace, temporaryDirectory);
if (
  !temporaryRelative ||
  temporaryRelative === ".." ||
  temporaryRelative.startsWith(`..${sep}`)
) {
  throw new Error("Refusing to create smoke-test files outside the workspace.");
}
if (existsSync(temporaryDirectory)) {
  throw new Error(`Refusing to overwrite existing ${temporaryRelative}.`);
}

const sql = getDatabase();
try {
  const childEnvironment = createVercelCurlEnvironment();
  const idempotencyKey = randomUUID();
  const verificationMarker = `REMOTE-${idempotencyKey.slice(0, 8)}`;
  const uncertainRequestDeadlineMs = 75_000;
  const uncertainRequestPollMs = 2_000;
  let captureId;
  let assetPaths = [];
  let aiRunIds = [];
  let resultSummary;
  let cleanupSummary;
  let postStartedAt;
  let postResponseReceived = false;
  let reconciliationUnresolved = false;

  function vercelCurl(path, curlArguments) {
    const command = createVercelCommand([
      "curl",
      path,
      "--deployment",
      deployment,
      "--",
      "--silent",
      "--show-error",
      "--max-time",
      "35",
      ...curlArguments,
      "--write-out",
      "\\n__PERSNAPSE_STATUS__:%{http_code}",
    ]);
    const response = spawnSync(command.executable, command.arguments, {
      cwd: workspace,
      env: childEnvironment,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (response.status !== 0) {
      throw new Error(
        `Protected Preview request failed before an HTTP response (exit ${response.status ?? "unknown"}).`,
      );
    }
    const marker = "__PERSNAPSE_STATUS__:";
    const markerIndex = response.stdout.lastIndexOf(marker);
    if (markerIndex < 0) {
      throw new Error(
        "Protected Preview response did not include an HTTP status.",
      );
    }
    const body = response.stdout.slice(0, markerIndex).trim();
    const status = Number(
      response.stdout.slice(markerIndex + marker.length).trim(),
    );
    return { body, status };
  }

  async function findCapture() {
    const [row] = await sql`
    select id from public.capture_sessions
    where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
    return row?.id;
  }

  async function readOperation() {
    const [row] = await sql`
    select
      capture_session_id,
      status,
      provider_request_started_at is not null as provider_started,
      completed_at is not null as completed
    from public.ocr_provider_calls
    where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
      and provider_scope = ${providerScope}
      and operation_key = ${idempotencyKey}::uuid
    limit 1
  `;
    if (!row) return null;
    return {
      captureSessionId: row.capture_session_id,
      status: row.status,
      providerStarted: row.provider_started,
      completed: row.completed,
    };
  }

  async function reconcileUncertainRequest(startedAt) {
    console.log(
      `[preview-smoke] response uncertain; operationKey=${idempotencyKey} automaticRetry=disabled reconciliation=waiting`,
    );
    const deadline = startedAt + uncertainRequestDeadlineMs;
    let operation = null;
    let foundCaptureId;

    while (Date.now() < deadline) {
      foundCaptureId = await findCapture();
      operation = await readOperation();
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, Math.min(uncertainRequestPollMs, remaining)),
        );
      }
    }

    foundCaptureId = await findCapture();
    operation = await readOperation();
    return {
      captureId: foundCaptureId ?? operation?.captureSessionId,
      operation,
    };
  }

  async function readAssetPaths(activeCaptureId) {
    const rows = await sql`
    select storage_path from public.source_assets
    where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
      and capture_session_id = ${activeCaptureId}
      and asset_kind = 'image'
  `;
    return rows.map((row) => row.storage_path);
  }

  async function readAiRunIds(activeCaptureId) {
    const rows = await sql`
    select id from public.ai_runs
    where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
      and capture_session_id = ${activeCaptureId}
  `;
    return rows.map((row) => row.id);
  }

  async function verifyCleanup(activeCaptureId, paths, runIds) {
    const [residue] = await sql`
    select
      (
        (select count(*) from public.capture_sessions
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and id = ${activeCaptureId})
        + (select count(*) from public.business_card_drafts
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and capture_session_id = ${activeCaptureId})
        + (select count(*) from public.business_cards
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and capture_session_id = ${activeCaptureId})
        + (select count(*) from public.source_assets
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and capture_session_id = ${activeCaptureId})
        + (select count(*) from public.ai_runs
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and id = any(${runIds}::uuid[]))
        + (select count(*) from public.provenance_records
          where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
            and source_ref = ${`capture_session:${activeCaptureId}`})
      ) as database_rows,
      (
        select count(*) from storage.objects
        where bucket_id = 'business-card-assets'
          and name = any(${paths}::text[])
      ) as storage_objects
  `;
    return {
      databaseRows: Number(residue.database_rows),
      storageObjects: Number(residue.storage_objects),
    };
  }

  let primaryError;

  try {
    mkdirSync(temporaryDirectory, { recursive: false });
    const image = await createSyntheticBusinessCardImage(verificationMarker);
    const imagePath = resolve(temporaryDirectory, "synthetic-card.png");
    writeFileSync(imagePath, image.bytes, { mode: 0o600 });

    console.log(
      `[preview-smoke] operationKey=${idempotencyKey} paidRequestsAuthorized=1 automaticRetry=disabled`,
    );
    postStartedAt = Date.now();
    const response = vercelCurl("/api/business-cards", [
      "--request",
      "POST",
      "--form-string",
      `idempotencyKey=${idempotencyKey}`,
      "--form-string",
      `referenceTime=${new Date().toISOString()}`,
      "--form-string",
      `originalWidth=${image.width}`,
      "--form-string",
      `originalHeight=${image.height}`,
      "--form-string",
      `displayWidth=${image.width}`,
      "--form-string",
      `displayHeight=${image.height}`,
      "--form-string",
      "processingRecipe=canvas-card-v1",
      "--form",
      `original=@${imagePath};type=image/png;filename=synthetic-original.png`,
      "--form",
      `display=@${imagePath};type=image/png;filename=synthetic-display.png`,
    ]);
    postResponseReceived = true;

    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      throw new Error(`Preview OCR returned non-JSON HTTP ${response.status}.`);
    }
    if (typeof payload.captureId === "string") {
      captureId = payload.captureId;
    }
    if (response.status !== 201) {
      throw new Error(
        `Preview OCR returned HTTP ${response.status} (${typeof payload.code === "string" ? payload.code : "UNKNOWN"}).`,
      );
    }
    if (
      payload.ocrProvider !== expectedProvider ||
      typeof payload.ocrLatencyMs !== "number" ||
      !payload.draft ||
      payload.state !== "draft" ||
      payload.stage !== "card_review" ||
      payload.draft.schemaVersion !== "business-card-draft-v1" ||
      !Array.isArray(payload.draft.observedFields) ||
      payload.draft.observedFields.length === 0 ||
      (!payload.draft.identity?.displayName &&
        !payload.draft.identity?.organizationName) ||
      !(
        (payload.draft.identity?.emails?.length ?? 0) +
          (payload.draft.identity?.phones?.length ?? 0) >
        0
      ) ||
      payload.lastErrorCode !== null ||
      payload.commitResult !== null
    ) {
      throw new Error(
        "Preview OCR response did not match the live draft contract.",
      );
    }

    resultSummary = {
      httpStatus: response.status,
      provider: payload.ocrProvider,
      latencyMs: payload.ocrLatencyMs,
      state: payload.state,
      stage: payload.stage,
      observedFieldCount: Array.isArray(payload.draft.observedFields)
        ? payload.draft.observedFields.length
        : 0,
      hasDisplayNameOrOrganization: Boolean(
        payload.draft.identity.displayName ||
        payload.draft.identity.organizationName,
      ),
      contactCount:
        payload.draft.identity.emails.length +
        payload.draft.identity.phones.length,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (postStartedAt && !postResponseReceived) {
      const reconciled = await reconcileUncertainRequest(postStartedAt);
      captureId ??= reconciled.captureId;
      if (!captureId) {
        reconciliationUnresolved = true;
      }
    }
    captureId ??= await findCapture();
    if (captureId) {
      assetPaths = await readAssetPaths(captureId);
      aiRunIds = await readAiRunIds(captureId);
      try {
        const deletion = vercelCurl(`/api/business-cards/${captureId}`, [
          "--request",
          "DELETE",
          "--output",
          process.platform === "win32" ? "NUL" : "/dev/null",
        ]);
        if (deletion.status !== 204) {
          throw new Error(`Remote cleanup returned HTTP ${deletion.status}.`);
        }
      } catch {
        await discardBusinessCardCapture(
          environment.APP_DEFAULT_WORKSPACE_ID,
          captureId,
        );
      }
      await removeBusinessCardAssets(assetPaths);
      if (aiRunIds.length > 0) {
        await sql`
        delete from public.ai_runs
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = any(${aiRunIds}::uuid[])
      `;
      }
      const deletedCapture = vercelCurl(`/api/business-cards/${captureId}`, [
        "--request",
        "GET",
        "--output",
        process.platform === "win32" ? "NUL" : "/dev/null",
      ]);
      if (deletedCapture.status !== 404) {
        throw new Error(
          `Deleted synthetic Capture remained reachable (HTTP ${deletedCapture.status}).`,
        );
      }
      cleanupSummary = {
        ...(await verifyCleanup(captureId, assetPaths, aiRunIds)),
        deletedCaptureHttpStatus: deletedCapture.status,
      };
    } else {
      cleanupSummary = {
        databaseRows: reconciliationUnresolved ? null : 0,
        storageObjects: reconciliationUnresolved ? null : 0,
        deletedCaptureHttpStatus: null,
      };
    }
  }

  const operationAfter = await readOperation();
  const paidCall = {
    ledgerRows: operationAfter ? 1 : 0,
    providerRequestsStarted: operationAfter?.providerStarted ? 1 : 0,
    succeeded: operationAfter?.status === "succeeded" ? 1 : 0,
    failed: operationAfter?.status === "failed" ? 1 : 0,
  };

  if (reconciliationUnresolved) {
    throw new Error(
      `The uncertain request could not be reconciled after 75 seconds. Do not rerun the paid POST. Manually inspect operationKey=${idempotencyKey} before any further live OCR test.`,
    );
  }
  if (
    !cleanupSummary ||
    cleanupSummary.databaseRows !== 0 ||
    cleanupSummary.storageObjects !== 0
  ) {
    throw new Error("Synthetic Preview data cleanup verification failed.");
  }
  if (primaryError) throw primaryError;
  if (
    paidCall.ledgerRows !== 1 ||
    paidCall.providerRequestsStarted !== 1 ||
    paidCall.succeeded !== 1 ||
    paidCall.failed !== 0 ||
    !operationAfter?.completed
  ) {
    throw new Error(
      `Expected one successful provider call for the exact operation key, observed ${JSON.stringify(paidCall)}.`,
    );
  }
  console.log(
    JSON.stringify(
      {
        deployment,
        liveOcr: resultSummary,
        paidCall,
        cleanup: cleanupSummary,
      },
      null,
      2,
    ),
  );
} finally {
  if (existsSync(temporaryDirectory)) {
    rmSync(temporaryDirectory, { recursive: true, force: false });
  }
  await closeDatabase();
}
