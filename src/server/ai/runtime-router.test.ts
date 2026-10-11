import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { parseServerEnv, type ServerEnv } from "../env";
import {
  AiTaskExecutionError,
  executeAiTask,
  resolveAiRoute,
  type AiTaskAdapter,
} from "./runtime-router";

function environment(
  overrides: Partial<Record<keyof ServerEnv, string | undefined>> = {},
): ServerEnv {
  return parseServerEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
    APP_DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
    ...overrides,
  });
}

const outputSchema = z.object({ value: z.string() }).strict();

describe("AI runtime router", () => {
  it("selects OpenAI vision only when configured for business cards", () => {
    const env = environment({
      BUSINESS_CARD_OCR_PROVIDER: "openai",
      OPENAI_API_KEY: "secret",
      OPENAI_STRUCTURING_MODEL: "vision-model",
    });
    expect(resolveAiRoute("businessCardOcr", "primary", env)).toMatchObject({
      provider: "openai",
      target: "vision-model",
      available: true,
    });
    expect(resolveAiRoute("businessCardOcr", "fallback", env)).toBeUndefined();
  });
  it("applies environment model overrides to the executable route", () => {
    const route = resolveAiRoute(
      "informationStructuring",
      "primary",
      environment({
        AI_ROUTING_MODE: "live",
        OPENAI_API_KEY: "secret",
        OPENAI_STRUCTURING_MODEL: "structuring-override",
      }),
    );

    expect(route).toMatchObject({
      provider: "openai",
      target: "structuring-override",
      available: true,
      missingCredentials: [],
    });
  });

  it("routes the Main Agent to its dedicated OpenAI model setting", () => {
    const route = resolveAiRoute(
      "mainAgent",
      "primary",
      environment({
        AI_ROUTING_MODE: "live",
        OPENAI_API_KEY: "secret",
        OPENAI_MAIN_AGENT_MODEL: "main-agent-override",
      }),
    );

    expect(route).toMatchObject({
      provider: "openai",
      target: "main-agent-override",
      available: true,
      missingCredentials: [],
    });
    expect(
      resolveAiRoute("mainAgent", "benchmark", environment()),
    ).toBeUndefined();
  });

  it("uses only the deterministic adapter in mock mode", async () => {
    const mockAdapter = {
      execute: vi.fn(async () => ({ value: "mocked" })),
    };
    const liveAdapter = {
      execute: vi.fn(async () => ({ value: "live" })),
    };

    const result = await executeAiTask({
      task: "informationStructuring",
      environment: environment(),
      input: "context",
      outputSchema,
      mockAdapter,
      liveAdapters: { openai: liveAdapter },
    });

    expect(result).toEqual({ value: "mocked" });
    expect(mockAdapter.execute).toHaveBeenCalledOnce();
    expect(liveAdapter.execute).not.toHaveBeenCalled();
  });

  it("never silently falls back to mock when live credentials are missing", async () => {
    const mockAdapter = {
      execute: vi.fn(async () => ({ value: "mocked" })),
    };

    const execution = executeAiTask({
      task: "informationStructuring",
      environment: environment({ AI_ROUTING_MODE: "live" }),
      input: "context",
      outputSchema,
      mockAdapter,
    });

    await expect(execution).rejects.toMatchObject({
      code: "AI_CONFIGURATION_ERROR",
      retryable: false,
    });
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it("uses an available fallback route when the primary is not configured", async () => {
    const events: string[] = [];
    const fallbackAdapter: AiTaskAdapter<string> = {
      async execute() {
        return { value: "fallback" };
      },
    };

    const result = await executeAiTask({
      task: "informationStructuring",
      environment: environment({
        AI_ROUTING_MODE: "live",
        MISTRAL_API_KEY: "secret",
      }),
      input: "context",
      outputSchema,
      mockAdapter: {
        async execute() {
          return { value: "mocked" };
        },
      },
      liveAdapters: { mistral: fallbackAdapter },
      onAttempt(event) {
        events.push(`${event.lane}:${event.provider}:${event.status}`);
      },
    });

    expect(result).toEqual({ value: "fallback" });
    expect(events).toEqual(["fallback:mistral:succeeded"]);
  });

  it("records schema failure and retries without exposing the raw output", async () => {
    const events: Array<{ status: string; errorCode?: string }> = [];
    const adapter = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ unexpected: "shape" })
        .mockResolvedValueOnce({ value: "valid" }),
    };

    const result = await executeAiTask({
      task: "informationStructuring",
      environment: environment({
        AI_ROUTING_MODE: "live",
        OPENAI_API_KEY: "secret",
      }),
      input: "private context",
      outputSchema,
      mockAdapter: adapter,
      liveAdapters: { openai: adapter },
      onAttempt(event) {
        events.push({ status: event.status, errorCode: event.errorCode });
      },
    });

    expect(result).toEqual({ value: "valid" });
    expect(events).toEqual([
      { status: "failed", errorCode: "AI_SCHEMA_INVALID" },
      { status: "succeeded", errorCode: undefined },
    ]);
  });

  it("does not duplicate a provider request when telemetry persistence fails", async () => {
    const adapter = {
      execute: vi.fn(async () => ({ value: "valid" })),
    };

    const result = await executeAiTask({
      task: "informationStructuring",
      environment: environment({
        AI_ROUTING_MODE: "live",
        OPENAI_API_KEY: "secret",
      }),
      input: "private context",
      outputSchema,
      mockAdapter: adapter,
      liveAdapters: { openai: adapter },
      onAttempt() {
        throw new Error("telemetry unavailable");
      },
    });

    expect(result).toEqual({ value: "valid" });
    expect(adapter.execute).toHaveBeenCalledOnce();
  });

  it("classifies timeouts as retryable provider failures", async () => {
    const neverCompletes: AiTaskAdapter<string> = {
      execute: () => new Promise(() => undefined),
    };

    try {
      await executeAiTask({
        task: "informationStructuring",
        environment: environment({
          AI_ROUTING_MODE: "live",
          OPENAI_API_KEY: "secret",
        }),
        input: "context",
        outputSchema,
        mockAdapter: neverCompletes,
        liveAdapters: { openai: neverCompletes },
        timeoutMs: 5,
        maxAttemptsPerRoute: 1,
      });
      throw new Error("Expected the AI task to time out.");
    } catch (error) {
      expect(error).toBeInstanceOf(AiTaskExecutionError);
      expect(error).toMatchObject({
        code: "AI_TIMEOUT",
        retryable: true,
      });
    }
  });
});
