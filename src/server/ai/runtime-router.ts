import type { z } from "zod";

import type { ServerEnv } from "../env";
import {
  aiTaskRouting,
  type AiProviderId,
  type AiTaskId,
} from "./model-routing";

export type AiRouteLane = "primary" | "fallback" | "benchmark";

type ProviderCredentialKey =
  | "CLOVA_OCR_INVOKE_URL"
  | "CLOVA_OCR_SECRET"
  | "OPENAI_API_KEY"
  | "VOYAGE_API_KEY"
  | "GOOGLE_GENERATIVE_AI_API_KEY"
  | "GOOGLE_CLOUD_VISION_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "MISTRAL_API_KEY"
  | "TOGETHER_API_KEY"
  | "FIREWORKS_API_KEY";

interface RouteDefinition {
  provider: AiProviderId;
  target: string;
}

export interface ResolvedAiRoute extends RouteDefinition {
  task: AiTaskId;
  lane: AiRouteLane;
  requiredCredentials: ProviderCredentialKey[];
  missingCredentials: ProviderCredentialKey[];
  available: boolean;
}

function routeDefinition(
  task: AiTaskId,
  lane: AiRouteLane,
): RouteDefinition | undefined {
  const routing = aiTaskRouting[task] as Partial<
    Record<AiRouteLane, RouteDefinition>
  >;
  return routing[lane];
}

function overriddenTarget(
  task: AiTaskId,
  lane: AiRouteLane,
  environment: ServerEnv,
  defaultTarget: string,
): string {
  if (lane === "primary") {
    switch (task) {
      case "transcription":
        return environment.OPENAI_TRANSCRIPTION_MODEL;
      case "informationStructuring":
      case "taggingClassification":
        return environment.OPENAI_STRUCTURING_MODEL;
      case "embedding":
        return environment.VOYAGE_EMBEDDING_MODEL;
      case "reranking":
        return environment.VOYAGE_RERANK_MODEL;
      case "mainAgent":
        return environment.GOOGLE_MAIN_AGENT_MODEL;
      case "qualityAgent":
        return environment.ANTHROPIC_QUALITY_AGENT_MODEL;
      case "complexReasoning":
        return environment.OPENAI_COMPLEX_REASONING_MODEL;
      default:
        return defaultTarget;
    }
  }

  if (lane === "fallback") {
    if (task === "embedding") {
      return environment.OPENAI_EMBEDDING_FALLBACK_MODEL;
    }
    if (task === "complexReasoning") {
      return environment.ANTHROPIC_QUALITY_AGENT_MODEL;
    }
  }

  if (lane === "benchmark") {
    if (task === "mainAgent" || task === "qualityAgent") {
      return environment.OPENAI_QUALITY_BENCHMARK_MODEL;
    }
  }

  return defaultTarget;
}

function credentialKeys(
  task: AiTaskId,
  provider: AiProviderId,
): ProviderCredentialKey[] {
  switch (provider) {
    case "naver_clova":
      return ["CLOVA_OCR_INVOKE_URL", "CLOVA_OCR_SECRET"];
    case "openai":
      return ["OPENAI_API_KEY"];
    case "voyage":
      return ["VOYAGE_API_KEY"];
    case "google":
      return task === "businessCardOcr"
        ? ["GOOGLE_CLOUD_VISION_API_KEY"]
        : ["GOOGLE_GENERATIVE_AI_API_KEY"];
    case "anthropic":
      return ["ANTHROPIC_API_KEY"];
    case "mistral":
      return ["MISTRAL_API_KEY"];
    case "together":
      return ["TOGETHER_API_KEY"];
    case "fireworks":
      return ["FIREWORKS_API_KEY"];
  }
}

export function resolveAiRoute(
  task: AiTaskId,
  lane: AiRouteLane,
  environment: ServerEnv,
): ResolvedAiRoute | undefined {
  const definition = routeDefinition(task, lane);

  if (!definition) {
    return undefined;
  }

  const requiredCredentials = credentialKeys(task, definition.provider);
  const missingCredentials = requiredCredentials.filter(
    (key) => !environment[key],
  );

  return {
    task,
    lane,
    provider: definition.provider,
    target: overriddenTarget(task, lane, environment, definition.target),
    requiredCredentials,
    missingCredentials,
    available: missingCredentials.length === 0,
  };
}

export interface AiAdapterRequest<Input> {
  input: Input;
  model: string;
  signal: AbortSignal;
}

export interface AiTaskAdapter<Input> {
  execute(request: AiAdapterRequest<Input>): Promise<unknown>;
}

export interface AiAttemptEvent {
  task: AiTaskId;
  mode: "mock" | "live";
  lane: AiRouteLane | "mock";
  provider: AiProviderId | "local";
  model: string;
  attempt: number;
  status: "succeeded" | "failed" | "mocked";
  latencyMs: number;
  errorCode?: string;
}

export class AiTaskExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiTaskExecutionError";
  }
}

export interface ExecuteAiTaskOptions<Input, Output> {
  task: AiTaskId;
  environment: ServerEnv;
  input: Input;
  outputSchema: z.ZodType<Output>;
  mockAdapter: AiTaskAdapter<Input>;
  liveAdapters?: Partial<Record<AiProviderId, AiTaskAdapter<Input>>>;
  timeoutMs?: number;
  maxAttemptsPerRoute?: number;
  onAttempt?: (event: AiAttemptEvent) => Promise<void> | void;
}

async function executeWithTimeout<Input>(
  adapter: AiTaskAdapter<Input>,
  input: Input,
  model: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new AiTaskExecutionError(
          `AI task timed out after ${timeoutMs}ms.`,
          "AI_TIMEOUT",
          true,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      adapter.execute({ input, model, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function normalizedExecutionError(error: unknown): AiTaskExecutionError {
  if (error instanceof AiTaskExecutionError) {
    return error;
  }

  return new AiTaskExecutionError(
    "AI provider request failed.",
    "AI_PROVIDER_ERROR",
    true,
  );
}

async function emitAttempt(
  callback: ExecuteAiTaskOptions<unknown, unknown>["onAttempt"],
  event: AiAttemptEvent,
): Promise<void> {
  try {
    await callback?.(event);
  } catch {
    // Telemetry failure must never trigger a duplicate provider request.
  }
}

export async function executeAiTask<Input, Output>(
  options: ExecuteAiTaskOptions<Input, Output>,
): Promise<Output> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxAttempts = options.maxAttemptsPerRoute ?? 2;

  if (options.environment.AI_ROUTING_MODE === "mock") {
    const startedAt = performance.now();

    try {
      const rawOutput = await executeWithTimeout(
        options.mockAdapter,
        options.input,
        `mock:${options.task}`,
        timeoutMs,
      );
      const parsed = options.outputSchema.safeParse(rawOutput);

      if (!parsed.success) {
        throw new AiTaskExecutionError(
          "Mock adapter returned an invalid structured response.",
          "AI_SCHEMA_INVALID",
          false,
        );
      }

      await emitAttempt(options.onAttempt, {
        task: options.task,
        mode: "mock",
        lane: "mock",
        provider: "local",
        model: `mock:${options.task}`,
        attempt: 1,
        status: "mocked",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      return parsed.data;
    } catch (error) {
      const normalized = normalizedExecutionError(error);
      await emitAttempt(options.onAttempt, {
        task: options.task,
        mode: "mock",
        lane: "mock",
        provider: "local",
        model: `mock:${options.task}`,
        attempt: 1,
        status: "failed",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }

  const routes = (["primary", "fallback"] as const)
    .map((lane) => resolveAiRoute(options.task, lane, options.environment))
    .filter((route): route is ResolvedAiRoute => route !== undefined);
  const configurationProblems: string[] = [];
  let lastError: AiTaskExecutionError | undefined;

  for (const route of routes) {
    if (!route.available) {
      configurationProblems.push(
        `${route.provider}: ${route.missingCredentials.join(", ")}`,
      );
      continue;
    }

    const adapter = options.liveAdapters?.[route.provider];
    if (!adapter) {
      configurationProblems.push(`${route.provider}: adapter unavailable`);
      continue;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = performance.now();

      try {
        const rawOutput = await executeWithTimeout(
          adapter,
          options.input,
          route.target,
          timeoutMs,
        );
        const parsed = options.outputSchema.safeParse(rawOutput);

        if (!parsed.success) {
          throw new AiTaskExecutionError(
            "AI provider returned an invalid structured response.",
            "AI_SCHEMA_INVALID",
            true,
          );
        }

        await emitAttempt(options.onAttempt, {
          task: options.task,
          mode: "live",
          lane: route.lane,
          provider: route.provider,
          model: route.target,
          attempt,
          status: "succeeded",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        return parsed.data;
      } catch (error) {
        lastError = normalizedExecutionError(error);
        await emitAttempt(options.onAttempt, {
          task: options.task,
          mode: "live",
          lane: route.lane,
          provider: route.provider,
          model: route.target,
          attempt,
          status: "failed",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          errorCode: lastError.code,
        });

        if (!lastError.retryable) {
          break;
        }
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new AiTaskExecutionError(
    `No live route is available for ${options.task}. ${configurationProblems.join("; ")}`,
    "AI_CONFIGURATION_ERROR",
    false,
  );
}
