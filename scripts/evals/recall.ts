import { executeRecall } from "../../src/server/application/recall-service";
import { closeDatabase } from "../../src/server/db/client";
import { listGoldenQueryCases } from "../../src/server/db/recall-repository";
import { getServerEnv } from "../../src/server/env";

const environment = getServerEnv();

try {
  const cases = await listGoldenQueryCases(
    environment.APP_DEFAULT_WORKSPACE_ID,
  );
  const results = [];

  for (const evaluationCase of cases) {
    const response = await executeRecall({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      queryText: evaluationCase.queryText,
      referenceTime: new Date(evaluationCase.referenceTime),
      evaluationCaseId: evaluationCase.id,
    });
    const actualPersonIds = response.results.map((result) => result.personId);
    const actualEvidenceIds = response.results.flatMap((result) =>
      result.evidence.map((evidence) => evidence.id),
    );
    const statusPassed = response.status === evaluationCase.expectationStatus;
    const peoplePassed =
      evaluationCase.expectationStatus === "ambiguous"
        ? evaluationCase.expectedPersonIds.every((personId) =>
            actualPersonIds.includes(personId),
          )
        : evaluationCase.expectationStatus === "no_result"
          ? actualPersonIds.length === 0
          : actualPersonIds[0] === evaluationCase.expectedPersonIds[0];
    const evidencePassed =
      evaluationCase.expectedEvidenceIds.length === 0 ||
      evaluationCase.expectedEvidenceIds.some((evidenceId) =>
        actualEvidenceIds.includes(evidenceId),
      );

    results.push({
      category: evaluationCase.category,
      label: evaluationCase.label,
      status: response.status,
      topPersonId: actualPersonIds[0] ?? null,
      latencyMs: response.latencyMs,
      passed: statusPassed && peoplePassed && evidencePassed,
      statusPassed,
      peoplePassed,
      evidencePassed,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const summary = {
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
    baseline: 1,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.passRate < summary.baseline) {
    process.exitCode = 1;
  }
} finally {
  await closeDatabase();
}
