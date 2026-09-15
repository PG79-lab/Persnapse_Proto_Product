import { z } from "zod";

import { getServerEnv, type ServerEnv } from "../../src/server/env";
import {
  resolveAiRoute,
  type AiRouteLane,
  type ResolvedAiRoute,
} from "../../src/server/ai/runtime-router";
import type { AiTaskId } from "../../src/server/ai/model-routing";

const confirmationFlag = "--confirm-live";
const requestTimeoutMs = 45_000;
const maxAcceptedMainAgentLatencyMs = 15_000;
const syntheticContext = {
  personName: "김하늘",
  topic: "부산 물류 실증",
} as const;

const syntheticMainAgentResult = {
  answer: "김하늘은 부산 물류 실증 후속 미팅과 관련되어 있습니다.",
  evidenceId: "synthetic-evidence-1",
} as const;

const contextResultSchema = z
  .object({
    personName: z.literal(syntheticContext.personName),
    topic: z.literal(syntheticContext.topic),
  })
  .strict();

const contextJsonSchema = {
  type: "object",
  properties: {
    personName: {
      type: "string",
      enum: [syntheticContext.personName],
      description: "합성 입력에 명시된 인물 이름",
    },
    topic: {
      type: "string",
      enum: [syntheticContext.topic],
      description: "합성 입력에 명시된 대화 주제",
    },
  },
  required: ["personName", "topic"],
  additionalProperties: false,
} as const;

const mainAgentResultSchema = z
  .object({
    answer: z.literal(syntheticMainAgentResult.answer),
    evidenceIds: z
      .array(z.literal(syntheticMainAgentResult.evidenceId))
      .length(1),
  })
  .strict();

const mainAgentJsonSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      enum: [syntheticMainAgentResult.answer],
      description: "제공된 합성 Evidence만 사용한 답변",
    },
    evidenceIds: {
      type: "array",
      items: {
        type: "string",
        enum: [syntheticMainAgentResult.evidenceId],
      },
      minItems: 1,
      maxItems: 1,
      description: "답변을 직접 뒷받침하는 Evidence ID",
    },
  },
  required: ["answer", "evidenceIds"],
  additionalProperties: false,
} as const;

type VerificationMetrics = Record<string, number | string | null>;

interface VerificationCase {
  name: string;
  route: ResolvedAiRoute;
  run: () => Promise<VerificationMetrics>;
}

interface VerificationResult {
  name: string;
  task: AiTaskId;
  lane: AiRouteLane;
  provider: string;
  model: string;
  status: "passed" | "failed";
  attempts: number;
  latencyMs: number;
  metrics?: VerificationMetrics;
  error?: {
    code: string;
    httpStatus: number | null;
    message: string;
  };
}

class LiveVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "LiveVerificationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRoute(
  task: AiTaskId,
  lane: AiRouteLane,
  environment: ServerEnv,
): ResolvedAiRoute {
  const route = resolveAiRoute(task, lane, environment);

  if (!route) {
    throw new LiveVerificationError(
      "ROUTE_UNDEFINED",
      `No ${lane} route is defined for ${task}.`,
    );
  }

  if (!route.available) {
    throw new LiveVerificationError(
      "CREDENTIAL_MISSING",
      `Missing credential variables for ${task}: ${route.missingCredentials.join(", ")}.`,
    );
  }

  return route;
}

function redactMessage(
  value: string,
  secrets: readonly (string | undefined)[],
): string {
  let sanitized = value;

  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.replaceAll(secret, "[REDACTED]");
    }
  }

  return sanitized
    .replace(/\b(?:sk|pa|AIza)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  return fallback;
}

async function requestJson(
  url: string,
  init: RequestInit,
  secrets: readonly (string | undefined)[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new LiveVerificationError(
      timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      timedOut
        ? `Provider request timed out after ${requestTimeoutMs}ms.`
        : "Provider request could not reach the API endpoint.",
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let payload: unknown;

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new LiveVerificationError(
      response.ok ? "INVALID_JSON_RESPONSE" : `HTTP_${response.status}`,
      `Provider returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const message = providerErrorMessage(
      payload,
      `Provider request failed with HTTP ${response.status}.`,
    );
    throw new LiveVerificationError(
      `HTTP_${response.status}`,
      redactMessage(message, secrets),
      response.status,
    );
  }

  return payload;
}

function parseStructuredContext(rawText: string): void {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new LiveVerificationError(
      "STRUCTURED_OUTPUT_INVALID_JSON",
      "Provider output was not valid JSON.",
    );
  }

  const parsed = contextResultSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new LiveVerificationError(
      "STRUCTURED_OUTPUT_SCHEMA_MISMATCH",
      "Provider output did not match the expected synthetic context schema.",
    );
  }
}

function parseMainAgentResult(rawText: string): void {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new LiveVerificationError(
      "MAIN_AGENT_OUTPUT_INVALID_JSON",
      "Main Agent output was not valid JSON.",
    );
  }

  const parsed = mainAgentResultSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new LiveVerificationError(
      "MAIN_AGENT_OUTPUT_SCHEMA_MISMATCH",
      "Main Agent output did not match the evidence-constrained schema.",
    );
  }
}

function openAiOutputText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new LiveVerificationError(
      "OPENAI_RESPONSE_SHAPE_INVALID",
      "OpenAI response did not include an output array.",
    );
  }

  const textParts: string[] = [];

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        textParts.push(content.text);
      }
    }
  }

  const outputText = textParts.join("");

  if (!outputText) {
    throw new LiveVerificationError(
      "OPENAI_OUTPUT_TEXT_MISSING",
      "OpenAI response did not include structured output text.",
    );
  }

  return outputText;
}

function finiteEmbedding(
  payload: unknown,
  expectedDimensions: number,
): number[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new LiveVerificationError(
      "EMBEDDING_RESPONSE_SHAPE_INVALID",
      "Embedding response did not include a data array.",
    );
  }

  const first = payload.data[0];
  if (!isRecord(first) || !Array.isArray(first.embedding)) {
    throw new LiveVerificationError(
      "EMBEDDING_VECTOR_MISSING",
      "Embedding response did not include a vector.",
    );
  }

  const vector = first.embedding;
  if (
    vector.length !== expectedDimensions ||
    !vector.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    throw new LiveVerificationError(
      "EMBEDDING_DIMENSION_MISMATCH",
      `Expected a finite ${expectedDimensions}-dimension embedding vector.`,
    );
  }

  return vector;
}

function numericMetric(record: unknown, key: string): number | null {
  if (!isRecord(record)) {
    return null;
  }

  return typeof record[key] === "number" ? record[key] : null;
}

function openAiUsage(payload: unknown): VerificationMetrics {
  const usage = isRecord(payload) ? payload.usage : undefined;
  return {
    inputTokens: numericMetric(usage, "input_tokens"),
    outputTokens: numericMetric(usage, "output_tokens"),
    totalTokens: numericMetric(usage, "total_tokens"),
  };
}

function openAiEmbeddingUsage(payload: unknown): VerificationMetrics {
  const usage = isRecord(payload) ? payload.usage : undefined;
  return {
    promptTokens: numericMetric(usage, "prompt_tokens"),
    totalTokens: numericMetric(usage, "total_tokens"),
  };
}

function voyageUsage(payload: unknown): VerificationMetrics {
  const usage = isRecord(payload) ? payload.usage : undefined;
  return {
    totalTokens: numericMetric(usage, "total_tokens"),
  };
}

interface MainAgentSample {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  serviceTier: string;
}

async function runMainAgentSample(
  route: ResolvedAiRoute,
  apiKey: string,
  secrets: readonly (string | undefined)[],
  sampleNumber: number,
): Promise<MainAgentSample> {
  const startedAt = performance.now();
  const payload = await requestJson(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: route.target,
        store: false,
        reasoning: {
          effort: "none",
        },
        instructions:
          "Answer only from the supplied synthetic Evidence. Return the required JSON object without adding facts.",
        input: [
          `Synthetic request sequence: ${sampleNumber}`,
          "Question: 부산 물류 실증 후속 미팅과 관련된 사람은 누구인가?",
          `Evidence ${syntheticMainAgentResult.evidenceId}: 김하늘은 부산 물류 실증 후속 미팅과 관련되어 있습니다.`,
        ].join("\n"),
        text: {
          format: {
            type: "json_schema",
            name: "persnapse_main_agent_smoke_v1",
            strict: true,
            schema: mainAgentJsonSchema,
          },
        },
        max_output_tokens: 160,
      }),
    },
    secrets,
  );

  parseMainAgentResult(openAiOutputText(payload));
  const usage = isRecord(payload) ? payload.usage : undefined;

  return {
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    inputTokens: numericMetric(usage, "input_tokens") ?? 0,
    outputTokens: numericMetric(usage, "output_tokens") ?? 0,
    totalTokens: numericMetric(usage, "total_tokens") ?? 0,
    serviceTier:
      isRecord(payload) && typeof payload.service_tier === "string"
        ? payload.service_tier
        : "unreported",
  };
}

function percentile(values: readonly number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * ratio) - 1);
  return ordered[index] ?? 0;
}

async function verifyMainAgentReliability(
  route: ResolvedAiRoute,
  apiKey: string,
  secrets: readonly (string | undefined)[],
): Promise<VerificationMetrics> {
  const warmup = await runMainAgentSample(route, apiKey, secrets, 1);
  const burst = await Promise.all(
    [2, 3, 4, 5].map((sampleNumber) =>
      runMainAgentSample(route, apiKey, secrets, sampleNumber),
    ),
  );
  const samples = [warmup, ...burst];
  const latencies = samples.map((sample) => sample.latencyMs);
  const maximumLatencyMs = Math.max(...latencies);
  const p95LatencyMs = percentile(latencies, 0.95);

  if (maximumLatencyMs > maxAcceptedMainAgentLatencyMs) {
    throw new LiveVerificationError(
      "MAIN_AGENT_LATENCY_BOTTLENECK",
      `Main Agent exceeded the ${maxAcceptedMainAgentLatencyMs}ms smoke threshold (p95 ${p95LatencyMs}ms, max ${maximumLatencyMs}ms).`,
    );
  }

  return {
    schema: "evidence-constrained-answer-v1",
    samples: samples.length,
    concurrentBurst: burst.length,
    reasoningEffort: "none",
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs,
    maxLatencyMs: maximumLatencyMs,
    averageLatencyMs: Math.round(
      latencies.reduce((total, latency) => total + latency, 0) /
        latencies.length,
    ),
    slowThresholdMs: maxAcceptedMainAgentLatencyMs,
    totalInputTokens: samples.reduce(
      (total, sample) => total + sample.inputTokens,
      0,
    ),
    totalOutputTokens: samples.reduce(
      (total, sample) => total + sample.outputTokens,
      0,
    ),
    totalTokens: samples.reduce(
      (total, sample) => total + sample.totalTokens,
      0,
    ),
    serviceTiers: [
      ...new Set(samples.map((sample) => sample.serviceTier)),
    ].join(","),
  };
}

function normalizeError(
  error: unknown,
  secrets: readonly (string | undefined)[],
): LiveVerificationError {
  if (error instanceof LiveVerificationError) {
    return new LiveVerificationError(
      error.code,
      redactMessage(error.message, secrets),
      error.httpStatus,
    );
  }

  return new LiveVerificationError(
    "UNEXPECTED_ERROR",
    error instanceof Error
      ? redactMessage(error.message, secrets)
      : "Unexpected verification error.",
  );
}

function isRetryable(error: LiveVerificationError): boolean {
  return (
    error.code === "NETWORK_ERROR" ||
    error.code === "REQUEST_TIMEOUT" ||
    error.httpStatus === 408 ||
    error.httpStatus === 429 ||
    (error.httpStatus !== null && error.httpStatus >= 500)
  );
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
}

if (!process.argv.includes(confirmationFlag)) {
  console.error(
    `Live API verification requires ${confirmationFlag}; this guard prevents accidental paid calls.`,
  );
  process.exit(2);
}

const configuredEnvironment = getServerEnv();
const liveEnvironment: ServerEnv = {
  ...configuredEnvironment,
  AI_ROUTING_MODE: "live",
};
const secrets = [
  liveEnvironment.OPENAI_API_KEY,
  liveEnvironment.VOYAGE_API_KEY,
] as const;

const structuringRoute = requiredRoute(
  "informationStructuring",
  "primary",
  liveEnvironment,
);
const voyageEmbeddingRoute = requiredRoute(
  "embedding",
  "primary",
  liveEnvironment,
);
const openAiEmbeddingRoute = requiredRoute(
  "embedding",
  "fallback",
  liveEnvironment,
);
const rerankingRoute = requiredRoute("reranking", "primary", liveEnvironment);
const mainAgentRoute = requiredRoute("mainAgent", "primary", liveEnvironment);

const openAiKey = liveEnvironment.OPENAI_API_KEY;
const voyageKey = liveEnvironment.VOYAGE_API_KEY;

if (!openAiKey || !voyageKey) {
  throw new LiveVerificationError(
    "CREDENTIAL_MISSING",
    "One or more live verification credentials are missing.",
  );
}

const verificationCases: VerificationCase[] = [
  {
    name: "openai-structured-output",
    route: structuringRoute,
    run: async () => {
      const payload = await requestJson(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: structuringRoute.target,
            store: false,
            instructions:
              "Extract only explicit facts from the synthetic input. Return the required JSON object.",
            input:
              "합성 테스트 데이터입니다. 김하늘과 부산 물류 실증에 관해 대화했습니다.",
            text: {
              format: {
                type: "json_schema",
                name: "persnapse_live_context_smoke_v1",
                strict: true,
                schema: contextJsonSchema,
              },
            },
            max_output_tokens: 160,
          }),
        },
        secrets,
      );

      parseStructuredContext(openAiOutputText(payload));
      return {
        schema: "capture-context-smoke-v1",
        ...openAiUsage(payload),
      };
    },
  },
  {
    name: "openai-embedding-fallback",
    route: openAiEmbeddingRoute,
    run: async () => {
      const payload = await requestJson(
        "https://api.openai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: openAiEmbeddingRoute.target,
            input: "합성 관계 기억: 부산 물류 실증 후속 미팅",
            dimensions: 1024,
            encoding_format: "float",
          }),
        },
        secrets,
      );

      const vector = finiteEmbedding(payload, 1024);
      return {
        dimensions: vector.length,
        ...openAiEmbeddingUsage(payload),
      };
    },
  },
  {
    name: "voyage-embedding-primary",
    route: voyageEmbeddingRoute,
    run: async () => {
      const payload = await requestJson(
        "https://api.voyageai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${voyageKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: voyageEmbeddingRoute.target,
            input: ["합성 관계 기억: 부산 물류 실증 후속 미팅"],
            input_type: "document",
            output_dimension: 1024,
            output_dtype: "float",
            truncation: false,
          }),
        },
        secrets,
      );

      const vector = finiteEmbedding(payload, 1024);
      return {
        dimensions: vector.length,
        ...voyageUsage(payload),
      };
    },
  },
  {
    name: "voyage-rerank-primary",
    route: rerankingRoute,
    run: async () => {
      const payload = await requestJson(
        "https://api.voyageai.com/v1/rerank",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${voyageKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: rerankingRoute.target,
            query: "부산 물류 실증",
            documents: [
              "김하늘과 부산 물류 실증의 다음 단계와 후속 미팅을 논의했다.",
              "이도윤과 서울 전시회 저녁 식사 일정을 조율했다.",
            ],
            top_k: 2,
            return_documents: false,
            truncation: false,
          }),
        },
        secrets,
      );

      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        throw new LiveVerificationError(
          "RERANK_RESPONSE_SHAPE_INVALID",
          "Rerank response did not include a data array.",
        );
      }

      const first = payload.data[0];
      if (
        !isRecord(first) ||
        first.index !== 0 ||
        typeof first.relevance_score !== "number"
      ) {
        throw new LiveVerificationError(
          "RERANK_ORDER_INVALID",
          "Reranker did not place the explicitly relevant synthetic document first.",
        );
      }

      return {
        topDocumentIndex: first.index,
        topRelevanceScore: first.relevance_score,
        ...voyageUsage(payload),
      };
    },
  },
  {
    name: "openai-main-agent-primary",
    route: mainAgentRoute,
    run: () => verifyMainAgentReliability(mainAgentRoute, openAiKey, secrets),
  },
];

const onlyCase = process.argv
  .find((argument) => argument.startsWith("--only="))
  ?.slice("--only=".length);
const selectedCases = onlyCase
  ? verificationCases.filter(
      (verificationCase) => verificationCase.name === onlyCase,
    )
  : verificationCases;

if (selectedCases.length === 0) {
  throw new LiveVerificationError(
    "VERIFICATION_CASE_UNKNOWN",
    `Unknown live verification case: ${onlyCase ?? ""}.`,
  );
}

const results: VerificationResult[] = [];

for (const verificationCase of selectedCases) {
  const startedAt = performance.now();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const metrics = await verificationCase.run();
      results.push({
        name: verificationCase.name,
        task: verificationCase.route.task,
        lane: verificationCase.route.lane,
        provider: verificationCase.route.provider,
        model: verificationCase.route.target,
        status: "passed",
        attempts: attempt,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        metrics,
      });
      break;
    } catch (error) {
      const normalized = normalizeError(error, secrets);

      if (attempt < 2 && isRetryable(normalized)) {
        await waitBeforeRetry(attempt);
        continue;
      }

      results.push({
        name: verificationCase.name,
        task: verificationCase.route.task,
        lane: verificationCase.route.lane,
        provider: verificationCase.route.provider,
        model: verificationCase.route.target,
        status: "failed",
        attempts: attempt,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        error: {
          code: normalized.code,
          httpStatus: normalized.httpStatus,
          message: normalized.message,
        },
      });
      break;
    }
  }
}

const passed = results.filter((result) => result.status === "passed").length;
const summary = {
  mode: "live",
  inputClassification: "synthetic-only",
  secretValuesLogged: false,
  passed,
  total: results.length,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (passed !== results.length) {
  process.exitCode = 1;
}
