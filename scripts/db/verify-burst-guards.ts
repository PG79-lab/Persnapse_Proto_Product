import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { getServerEnv } from "../../src/server/env";
import { reserveAiCall } from "../../src/server/db/ai-budget-repository";
import {
  reserveOcrProviderCall,
  clovaBusinessCardProviderScope,
} from "../../src/server/db/ocr-cost-guard-repository";
const db = getDatabase();
const environment = { ...getServerEnv(), AI_ROUTING_MODE: "live" as const };
const workspaceId = randomUUID(),
  captureId = randomUUID();
const rollback = new Error("ROLLBACK_SYNTHETIC_VERIFICATION");
let passed = false;
try {
  await db.begin(async (tx) => {
    // All fixture writes and repository side effects roll back together.
    globalThis.persnapseDatabaseClient = {
      begin: async (fn: (sql: typeof tx) => unknown) => fn(tx),
    } as unknown as typeof db;
    await tx`insert into public.workspaces(id,name) values (${workspaceId},'synthetic burst verification')`;
    await tx`insert into public.ai_call_reservations(workspace_id,task,created_at) select ${workspaceId},'synthetic_old',clock_timestamp()-interval '2 minutes' from generate_series(1,1000)`;
    await reserveAiCall(workspaceId, "synthetic_current", environment);
    await tx`insert into public.ai_call_reservations(workspace_id,task,created_at) select ${workspaceId},'synthetic_current',clock_timestamp() from generate_series(1,59)`;
    await assert.rejects(
      reserveAiCall(workspaceId, "synthetic_blocked", environment),
      { code: "AI_RATE_LIMITED" },
    );
    await tx`update public.ai_call_reservations set created_at=clock_timestamp()-interval '61 seconds' where workspace_id=${workspaceId} and task='synthetic_current'`;
    await reserveAiCall(workspaceId, "synthetic_recovered", environment);
    await tx`insert into public.capture_sessions(id,workspace_id,state,input_kind,structured_draft,model_draft,draft_schema_version,idempotency_key) values (${captureId},${workspaceId},'draft','business_card','{}'::jsonb,'{}'::jsonb,'business-card-draft-v1',${randomUUID()})`;
    const now = new Date("2099-03-01T00:00:00Z");
    const reserve = (
      hash: string,
      at: Date = now,
      operationKey: string = randomUUID(),
    ) =>
      reserveOcrProviderCall({
        workspaceId,
        captureId,
        operationKey,
        imageSha256: hash.repeat(64),
        now: at,
      });
    const op = randomUUID();
    await reserve("a", now, op);
    await assert.rejects(reserve("b", now, op), {
      code: "OCR_DUPLICATE_REQUEST",
    });
    await assert.rejects(reserve("a", new Date(+now + 1100)), {
      code: "OCR_DUPLICATE_IN_PROGRESS",
    });
    await assert.rejects(reserve("b", new Date(+now + 200)), {
      code: "OCR_RATE_LIMITED",
    });
    await tx`insert into public.ocr_provider_calls(workspace_id,capture_session_id,provider_scope,operation_key,image_sha256,status,reserved_at,completed_at,lease_expires_at) select ${workspaceId},${captureId},${clovaBusinessCardProviderScope},gen_random_uuid(),${"c".repeat(64)},'failed',${now},${now},${now} from generate_series(1,19)`;
    await assert.rejects(reserve("d", new Date(+now + 2000)), {
      code: "OCR_RATE_LIMITED",
    });
    await reserve("e", new Date(+now + 61000));
    await tx`insert into public.ocr_provider_calls(workspace_id,capture_session_id,provider_scope,operation_key,image_sha256,status,reserved_at,completed_at,lease_expires_at) select ${workspaceId},${captureId},${clovaBusinessCardProviderScope},gen_random_uuid(),${"f".repeat(64)},'failed',${new Date(+now - 86400000)},${now},${now} from generate_series(1,1000)`;
    await reserve("f", new Date(+now + 63000));
    passed = true;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {
    console.log(
      JSON.stringify({
        passed: false,
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    );
    process.exitCode = 1;
  }
} finally {
  globalThis.persnapseDatabaseClient = db;
  const [remaining] =
    await db`select count(*)::int as count from public.workspaces where id=${workspaceId}`;
  assert.equal(remaining.count, 0);
  await closeDatabase();
}
if (passed)
  console.log(
    JSON.stringify({
      passed: true,
      aiOldHistoryIgnored: 1000,
      aiBurstBlockedAt: 60,
      aiWindowRecovery: true,
      ocrBurstBlockedAt: 20,
      ocrSpacingAndDuplicatesPreserved: true,
      ocrOldHistoryIgnored: 1000,
      ocrWindowRecovery: true,
      rolledBack: true,
      paidCalls: 0,
    }),
  );
